---
title: 分库双写落地方案：配置、事务、补偿与灰度
date: 2026-11-19
description: 基于 ShardingSphere-JDBC 的分库双写落地设计——数据源与路由配置、写入顺序、事务边界、失败重试与补偿、幂等、灰度开关，附对账、全量切换与回滚步骤及监控指标。
tags: [分库分表, ShardingSphere, 双写, 灰度, 数据迁移]
---

# 分库双写落地方案：配置、事务、补偿与灰度

> 本文是 [《基于 ShardingSphere-JDBC 的分库双写方案笔记》](/posts/java/shard-jdbc-dual-write-notes) 的落地篇，只写「怎么做」。选型对比与边界见笔记篇。

## 〇、前置假设（未确认前请勿直接照搬）

| 假设项 | 本文取值 | 不成立的后果 |
| --- | --- | --- |
| 组件 | ShardingSphere-JDBC **5.x** | 5.0/5.1 的 `ShardingSphereDataSource` 构建 API 与 SPI 名称有差异 |
| 数据库 | MySQL 8.x，InnoDB，RR | 其它库的幂等/对账 SQL 需重写 |
| 框架 | Spring Boot 3.x + MyBatis | JPA 拦截点不同 |
| 一致性 | 最终一致，可容忍秒级延迟 | 若要求强一致，需改分布式事务，方案大改 |
| 权威库 | 迁移期老库权威、新库跟随 | 顺序与回滚方向相反 |

外加两个已声明的**简化假设**：表可新增 `ver`/`updated_at` 辅助列；业务写入有稳定业务唯一键可作幂等键。若不能加列，幂等需退化为「业务键 + 内容指纹」。

## 一、总体结构

```
业务服务
  └─ DualWriteTemplate (封装)               ← 双写入口，统一开关/幂等/补偿
       ├─ 老库 DataSource (ShardingSphereDataSource: oldCluster)
       └─ 新库 DataSource (ShardingSphereDataSource: newCluster)
                 ↑ 异步补写：本地消息表 / 队列表 → 补偿 Worker
binlog 链路 (Canal/CDC)：oldCluster ──回放──> newCluster   ← 全量+增量兜底
对账中枢：定时增量对账 + 全量 checksum 扫描
```

推荐做法：**核心写入同步落老库（本地事务），新库写入走「同事务写本地消息表 → 异步投递」**，做到「老库成功即业务成功，新库最终必达」。

## 二、数据源与路由配置

两个集群各一个 `ShardingSphereDataSource`，业务侧通过 `DualWriteTemplate` 选择写哪边；读路由由灰度开关控制。以下为**示意**（真实值以版本/规模为准）。

```yaml
# application.yml （示意，非生产参数）
spring:
  datasource:
    # 老库集群：ShardingSphere 管分片路由
    old:
      driver-class-name: com.mysql.cj.jdbc.Driver
    # 新库集群
    new:
      driver-class-name: com.mysql.cj.jdbc.Driver

dualwrite:
  enabled: true                 # 总开关（Nacos/Apollo 动态下发）
  writer: sync-then-async       # 老库本地事务 + 新库异步补写
  read-route: old               # old | gray | new
  gray-percent: 0               # 灰度读新库的比例（0~100）
  idempotent-ttl-days: 7        # 幂等键保留窗口
```

```java
// 两个 ShardingSphereDataSource 分别构建（示意）
Properties oldProps = new Properties();
oldProps.setProperty("jdbc-url", env.getProperty("dualwrite.old.url"));
oldProps.setProperty("username", env.getProperty("dualwrite.old.username"));
DataSource oldDs = ShardingSphereDataSourceFactory.createDataSource(
        oldProps, /* rules array */ Collections.emptyList(), Collections.emptyList());

// 规则文件示例（分片）——概念示意，5.x 也可用 YAML 驱动
// databaseName: ds_old
// rules: [ { !SHARDING: { tables: { t_order: { actualDataNodes: old.ds_old.t_order_${0..3} } } } } ]
```

可选更优雅的一种：在**一套逻辑库**里配 «老集群 + 新集群» 两个 physical Database，通过**Hint** 决定命中哪边；但对 5.x 而言，双写能力需自封装，使用多 `ShardingSphereDataSource` 反而更直白、可控，推荐后者。

**路由键要求**：所有双写表必须能从写入 DTO 中解析出分片键（如 `userId`/`orderId`），否则新库无法定位分片。缺分片键 → 直接拒绝双写并告警，不做「默认分片」兜底（会造成数据错位）。

## 三、写入顺序与事务边界

**顺序**：老库（权威）→ 新库（跟随）。

```java
@Service
public class DualWriteTemplate {
  @Transactional(transactionManager = "oldTx")   // ① 老库本地事务边界
  public void write(String bizKey, Runnable oldWrite,
                    Supplier<Message> newMsgFactory) {
    oldWrite.run();                                // ② 老库写入，失败直接抛出=业务失败
    if (!dualToggle.isDualWriteOn(bizKey) || !dualToggle.isReadNew(bizKey)) {
      return;                                      // ③ 开关：仅老库，或不双写
    }
    messageQueue.save(newMsgFactory.get());        // ④ 与老库写同事务落本地消息表
  }
}
```

- **事务边界**：绝不在同一 DB 事务里跨两个库。老库写入 + 本地消息表写入同属一个本地事务（原子），新库写入由异步 Worker 完成。
- **为何本地消息表**：保证「业务成功 ⇒ 有可靠的新库补写任务」；进程崩溃也不会丢补写。

## 四、失败重试与补偿

```java
@Scheduled(fixedDelay = 3000)
public void compensate() {
  for (Msg m : messageQueue.pollPending(100, /* maxRetry */ 8)) {
    try {
      newShardTemplate.execute(m.idempotentKey(), () -> applyToNew(m));
      messageQueue.markDone(m.id);
    } catch (DuplicateKeyException dup) {
      messageQueue.markDone(m.id);               // 幂等命中，视为已写
    } catch (RetryableException e) {
      messageQueue.retryLater(m.id, backoff(m.retryCount)); // 指数退避 + 上限
    }
  }
}
```

- **重试策略**：指数退避 + 抖动 + 次数上限；超上限进「死信/修复工单」，由对账人工介入。
- **补偿来源有两层**：① 本地消息表重试；② binlog 回放（老库 → 新库）作为最终兜底——两层的幂等键必须一致，避免重复写。

## 五、幂等保证

新库侧每个写操作都必须幂等。三种做法，按表结构能力取舍：

| 方式 | 做法 | 条件 |
| --- | --- | --- |
| 唯一键 + UPSERT | 业务唯一键建唯一索引，写用 `INSERT ... ON DUPLICATE KEY UPDATE` | 有天然业务唯一键（首选） |
| 幂等表 | 独立 `t_dualwrite_idem(idem_key PK, status, created_at)`，写入前 `INSERT` 抢占 | 无业务唯一键、可加表 |
| 版本号/水位 | 行带 `ver`，写入要求 `ver >= 当前`，旧版本直接丢弃 | 表可加 `ver` 列，写带版本 |

> 并发「先删后增」场景下，仅靠 `ON DUPLICATE KEY UPDATE` 仍可能遇到与唯一键相关的锁放大，详见 [唯一键冲突一文](/posts/java/unique-key-delete-insert-conflict)。可在双写层把「删+增」改为「upsert 带状态翻转」以收敛语义。

## 六、灰度开关与流量控制

- **双写开关**：按 `tenantId`/`userId` 哈希或白名单决定是否双写，动态配置热更新。
- **读流量档位**：`old` → `gray(p%)` → `new`，配合影子读（灰度期同请求读两侧比对）。
- **熔断**：新库写入失败率超阈值自动降级为「仅老库 + 记录待补」，不阻塞主链路。
- **限流**：补偿 Worker 对新库有独立并发上限与令牌桶，避免追平时打满新库。

## 七、数据校验与对账

### 7.1 增量对账（分钟级）

```sql
-- 按业务时间窗口取两侧「变更集」，做差集（示意）
SELECT biz_key, ver, updated_at FROM t_order
WHERE updated_at >= :from AND updated_at < :to;
-- 两侧结果在应用层比对：缺行 / ver 落后 / 字段不一致 → 进差异表
```

### 7.2 全量对账（切换前后各一次）

- 分片逐片计算 `count(*)` 与关键列 `BIT_XOR(CRC32(...))` 之类 checksum；
- 不一致的分片再抽样明细；
- 差异率必须为 0 才准入切换。

### 7.3 差异处理

差异入「修复工单表」，支持：自动重放（用 binlog/消息重放单条）、人工确认、忽略（带原因）。**修复后必须复审，不能只标记完成。**

## 八、全量切换与回滚步骤

| 阶段 | 动作 | 准出条件 |
| --- | --- | --- |
| 0. 全量迁移 | CDC/工具把老库全量导入新库 | 迁移完成 |
| 1. 追增量 | binlog 回放追平 | 延迟 < 阈值 |
| 2. 双写开启 | 打开 dualwrite，新库异步补写 | 双写失败率 < 阈值、对账差异=0 |
| 3. 灰度读 | `gray` 逐步放量，影子读比对 | 读差异率 ~0 |
| 4. 全量读新 | `read-route=new`，老库仅写 | 观察 N 周期稳定 |
| 5. 停老库写 | 老库冻结为快照，保留回滚窗口 | — |
| ↺ 回滚 | 任一步异常：读切回老库、停新库写入，用差异回填老库 | 回滚后对账归零 |

**回滚铁律**：切流后老库「不可立即停写」，至少保留一个回滚窗口（如 24~72h，按业务定）继续双写或保留反填能力；否则回滚会丢这段时间的增量。

## 九、风险与监控指标

| 类别 | 指标 | 建议告警 |
| --- | --- | --- |
| 双写可靠性 | 双写失败率、本地消息堆积量、最老未消费消息年龄 | 失败率>阈值 / 堆积>N |
| 复制延迟 | binlog 应用延迟（秒、事务数） | 超阈值 |
| 数据一致性 | 增量对账差异条数、全量 checksum 差异分片数 | >0 |
| 性能 | 写 P99、连接池活跃数、双库 CPU | P99 回退超预算 |
| 冲突 | 1062/1213 计数、补偿重试率 | 突增 |
| 灰度 | 灰度租户数、影子读差异率 | 差异率>阈值 |

---

**收尾**：这套方案的骨架是「**老库权威 + 本地事务 + 异步必达 + binlog 兜底 + 对账准入**」。所有具体阈值、版本 API、字段名均为**示意**，请按第〇节前提确认后替换。
