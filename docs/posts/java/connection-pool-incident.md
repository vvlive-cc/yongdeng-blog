---
title: 一次线上 P0：数据库连接池耗尽，但监控没报警
date: 2026-11-18
description: 复盘一次耗时四小时的故障——连接池配置、慢查询、监控盲区，以及事后补的三道防线。
tags: [故障复盘, MySQL, 可观测性]
---

# 一次线上 P0：数据库连接池耗尽，但监控没报警

这是两年前的事故，但每次做容量规划我都会想起它。

## 现象

周三下午 2:17，客服群里开始有人反馈"下单页面一直转圈"。

2:20，告警终于来了——不是数据库告警，是**应用接口超时率 > 5%**。

2:22 我连上跳板机，第一眼看到的：

```
HikariPool-1 - Connection is not available, request timed out after 30000ms.
```

连接池拿不到连接了。

## 排查过程

### 第一步：连接池状态

```sql
-- 应用侧 JMX / actuator
hikaricp_connections_active    50
hikaricp_connections_idle       0
hikaricp_connections_pending   312
hikaricp_connections_max        50
```

50 个连接全被占着，312 个线程在排队。

问题是：**这 50 个连接在干什么？**

### 第二步：看数据库在做什么

```sql
SELECT id, user, time, state, LEFT(info, 120) AS sql_text
FROM information_schema.processlist
WHERE db = 'order_db'
ORDER BY time DESC;
```

结果：

```
| id   | user  | time | state | sql_text                                  |
|------|-------|------|-------|-------------------------------------------|
| 8821 | app   | 847  | Sending data | SELECT ... FROM t_order WHERE ... |
| 8822 | app   | 845  | Sending data | SELECT ... FROM t_order WHERE ... |
| ...  | ...   | ...  | ...   | ...                                       |
| 8869 | app   | 840  | Sending data | SELECT ... FROM t_order WHERE ... |
```

**47 个连接卡在同一条 SQL 上，已经跑了 14 分钟。**

关掉这些连接，服务立刻恢复。但这只是止血。

### 第三步：为什么这条 SQL 突然变慢

```sql
EXPLAIN SELECT * FROM t_order
WHERE merchant_id = 'xxx' AND status IN (1,2,3)
  AND create_time >= '2026-09-01'
ORDER BY create_time DESC
LIMIT 20;
```

执行计划：

```
type: ALL          <- 全表扫描！
rows: 8,432,190
key: NULL
Extra: Using where; Using filesort
```

之前走索引的。查了下当天的变更记录——**下午 2:05 有位同事发布了一个索引变更脚本**，把原来的联合索引删了重建，重建时用了个新顺序。

```sql
-- 原来
KEY idx_merchant_status_time (merchant_id, status, create_time)
-- 变更后
KEY idx_merchant_time_status (merchant_id, create_time, status)
```

看起来只是换了列顺序。但对这条 SQL：

- 原索引：`merchant_id` 等值 + `status` IN + `create_time` 范围 → 三列都能用上
- 新索引：`merchant_id` 等值 + `create_time` 范围 → `status` 用不上，且 `ORDER BY create_time` 也失效了

**索引列顺序这个细节，把一条走索引的查询变成了全表扫 840 万行。**

## 为什么监控没报警

这是最让我难受的部分。

我们有：
- 应用层：接口 RT、错误率、QPS
- 数据库层：CPU、连接数、慢查询日志

慢查询日志确实记了，但**阈值设的 5 秒**，而且只统计条数不告警。

**盲区在于：没有人监控"当前正在执行超过 10 秒的查询数"。**

连接池耗尽前有 14 分钟的窗口期，如果这时有告警，影响面能小一个数量级。

## 事后做的三件事

### 1. 连接池监控补齐

```java
// 定时上报，10 秒一次
Metric.gauge("hikari.active", pool.getActiveConnections());
Metric.gauge("hikari.pending", pool.getThreadsAwaitingConnection());
Metric.gauge("hikari.utilization",
    pool.getActiveConnections() * 1.0 / pool.getMaximumPoolSize());
```

告警规则：

| 指标 | 阈值 | 级别 |
| --- | --- | --- |
| `hikari_utilization` | > 0.85 持续 1min | P2 |
| `hikari_pending` | > 10 | P2 |
| `hikari_pending` | > 50 | P1 |
| 执行超 10s 的查询数 | > 5 | P1 |

### 2. 慢查询从"记日志"改成"实时统计"

```sql
-- 每 30 秒采集一次
SELECT COUNT(*) AS slow_count, MAX(time) AS max_time
FROM information_schema.processlist
WHERE command != 'Sleep' AND time > 10;
```

### 3. 索引变更流程

这次事故的根因不是技术，是**流程**：

- 索引变更没有经过 SQL 评审
- 没有在预发环境用生产数据量验证
- 没有评估对现有查询的影响
- 发布在下午高峰前，没有灰度

现在的规则：

> 任何索引变更必须提供：变更前后 `EXPLAIN` 对比、影响到的查询清单、回滚脚本，
> 且必须在业务低峰期执行。

## 补充：几个常被忽略的连接池配置

```yaml
spring:
  datasource:
    hikari:
      maximum-pool-size: 50          # 不是越大越好，要配合数据库最大连接数
      minimum-idle: 10
      connection-timeout: 3000       # 拿不到连接 3s 就失败，别等 30s
      idle-timeout: 600000
      max-lifetime: 1800000          # 小于数据库 wait_timeout
      leak-detection-threshold: 60000 # 连接借出超 60s 未归还就打印堆栈
```

`connection-timeout` 这个值：默认 30 秒。故障时 312 个请求各等 30 秒，
直接把 Tomcat 线程池也拖死了——**一个组件的超时设置会级联放大故障**。

改成 3 秒后，快速失败，前端能拿到明确的错误提示，用户重试即可。

`leak-detection-threshold` 是排查连接泄漏的神器，平时没开销，出问题时直接给你堆栈。

## 复盘结论

| 维度 | 问题 |
| --- | --- |
| 直接原因 | 索引列顺序变更导致全表扫描 |
| 放大因素 | 连接池 timeout 30s，线程被长时间占用 |
| 未及时发现 | 缺少"长事务/长查询"实时监控 |
| 流程缺失 | 索引变更无评审、无预发验证 |

真正值得记住的一条：

> **故障从来不是单一原因。是一个小错误，穿过了一层层本该拦住它的防线。**

这次是三层防线同时缺失：索引评审、慢查询告警、连接池监控。补上任何一层，都不会是 P0。
