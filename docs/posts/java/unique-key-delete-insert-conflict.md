---
title: MySQL 唯一索引在并发「先删后增」下的唯一键冲突
date: 2026-11-19
description: 并发事务执行「先 DELETE 再 INSERT」时触发 Duplicate entry，本文给出可复现的时序、InnoDB 锁快照与成因分析，并说明规避方案。
tags: [MySQL, 并发, 索引]
---

# MySQL 唯一索引在并发「先删后增」下的唯一键冲突

在并发场景下，两个事务对同一业务键执行「先删除再插入」时，`INSERT` 可能返回 `Duplicate entry`（错误码 1062）。而事务执行完成后查询该键，表中往往只有一行，甚至就是新插入的那一行。这一现象容易引起误判：删除操作已经返回影响行数，为什么插入仍然冲突。

本文围绕该问题展开：先描述现象，给出可复现的并发时序，再从唯一索引机制、InnoDB 加锁行为、隔离级别与 MVCC 三个层面分析成因，最后给出解决方案。结论基于 MySQL 8.0.46 的实测，涉及 5.7 的部分单独标注。

## 一、问题现象

### 1.1 报错信息

线上表现为偶发的唯一约束冲突，典型日志如下：

```
2026-11-18 14:22:07.418 ERROR 1 --- [http-nio-8080-exec-37] c.e.order.OrderSyncService
  : 同步订单失败, bizNo=A001
org.springframework.dao.DuplicateKeyException:
  ### Error updating database. Cause: java.sql.SQLIntegrityConstraintViolationException:
  Duplicate entry 'A001' for key 't_order.uk_biz_no'
```

需要关注的三个要点：

1. 错误码 **1062**，SQLSTATE `23000`，属于唯一约束冲突，不是死锁（1213）也不是锁等待超时（1205）。
2. 报错中的键名为 `t_order.uk_biz_no`。**MySQL 8.0 起 key 名带表名前缀**，5.7 为 `uk_biz_no`，详见第 3.6 节。
3. 报错由 `INSERT` 抛出，不是 `DELETE`。

### 1.2 现象的两种形态

**形态一：直接报错。** `INSERT` 立即返回 1062。

**形态二：先阻塞再报错。** `INSERT` 阻塞数秒（直到 `innodb_lock_wait_timeout`），随后返回 1062 或 1205。阻塞期间该语句一直在等待另一事务释放锁。

两种形态的共同点：冲突对象不是「表中存在两条重复数据」，而是「另一个已提交事务插入的同键新行」。执行完 `SELECT` 后，该键一般只存在一行。

## 二、复现场景

### 2.1 环境与建表

- MySQL 8.0.46，InnoDB，隔离级别 `REPEATABLE READ`（默认）。
- 唯一索引定义在业务键 `biz_no` 上。

```sql
CREATE TABLE t_uk (
  id      BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  biz_no  VARCHAR(32)     NOT NULL,
  status  TINYINT         NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  UNIQUE KEY uk_biz_no (biz_no)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO t_uk (biz_no, status) VALUES ('A001', 0);
```

初始表中存在一行 `('A001', 0)`，主键为 1。

### 2.2 触发冲突的最小并发时序

两个会话按如下顺序执行，关键是 T1 在步骤 ① 之后不提交，使 T2 的 ③ 进入锁等待。

```sql
-- 会话 T1
BEGIN;
DELETE FROM t_uk WHERE biz_no = 'A001';                    -- ① 影响 1 行
INSERT INTO t_uk (biz_no, status) VALUES ('A001', 1);      -- ② 成功
-- 不提交
```

```sql
-- 会话 T2（此时执行）
BEGIN;
INSERT INTO t_uk (biz_no, status) VALUES ('A001', 2);      -- ③ 阻塞，等待
```

```sql
-- 回到 T1
COMMIT;                                                    -- ④
```

T1 提交后，T2 的 `INSERT` 返回：

```
ERROR 1062 (23000): Duplicate entry 'A001' for key 't_uk.uk_biz_no'
```

实测 T2 的阻塞时长约 1.2 秒，等于 T1 从执行到提交的间隔。最终表内仅保留 T1 插入的行。注意 T2 未执行任何 `DELETE`，它只是插入了「已被删除又插入回来」的同键。

### 2.3 两个对照实验

**对照一：T1 只删不插。**

```sql
-- T1
BEGIN;
DELETE FROM t_uk WHERE biz_no = 'A001';
-- T2: INSERT ... 阻塞
COMMIT;   -- T2 的 INSERT 成功
```

若将 T1 的 `COMMIT` 改为 `ROLLBACK`，T2 的 `INSERT` 返回 1062，因为原行被恢复。

该对照说明：1062 的判定依据不是「T2 语句执行时刻表中的内容」，而是「T2 获得锁之后、唯一索引上是否仍存在该键」。T2 先排队，待 T1 落定后再基于最终状态判断。

**对照二：两个事务都执行完整的「先删后增」。**

T1 删除并插入且不提交；T2 也执行 `DELETE WHERE biz_no='A001'`。此时 T2 阻塞在 `DELETE` 上，而非 `INSERT`。T1 提交后，T2 的 `DELETE` 影响 1 行（删除 T1 新插入的行），随后 T2 的 `INSERT` 成功。

该对照说明：**两端对称的「先删后增」不会产生 1062，而是串行化执行。** 触发 1062 的是不对称组合，即一方删除并插入、另一方仅插入，或一方删除但插入失败。

## 三、原因分析

### 3.1 唯一性检查执行的是当前读

`REPEATABLE READ` 下，普通 `SELECT` 是快照读，基于 MVCC，看不到之后提交的行。容易由此推断「唯一性检查也看不到，因此不会冲突」，该推断是错的。

实测（RR）：

```sql
-- T2
SELECT COUNT(*) FROM t_uk WHERE biz_no='A001';   -- 0
-- T1: INSERT ('A001',1) 并 COMMIT
SELECT COUNT(*) FROM t_uk WHERE biz_no='A001';   -- 仍为 0，可重复读生效
INSERT INTO t_uk (biz_no,status) VALUES ('A001',2);  -- 1062
```

第二次快照读仍为 0，但 `INSERT` 报 1062。原因是唯一约束检查必须看到最新已提交的数据，不能建立在某个事务的 Read View 之上，否则约束失效。`SELECT ... FOR UPDATE` 同样能看到该行（实测 `COUNT(*) = 1`），因为它是当前读。

隔离级别不能解决此问题：**将隔离级别改为 `READ COMMITTED` 后，实测同样阻塞并报 1062**，锁形态基本一致。RC 只改变普通搜索的 gap lock 行为，不改变重复键检查加共享锁这一机制。

### 3.2 重复键检查会加共享锁

MySQL 8.0 官方文档 [17.7.3 Locks Set by Different SQL Statements in InnoDB](https://dev.mysql.com/doc/refman/8.0/en/innodb-locks-set.html) 中明确：

> If a duplicate-key error occurs, a shared lock on the duplicate index record is set. This use of a shared lock can result in deadlock should there be multiple sessions trying to insert the same row if another session already has an exclusive lock. **This can occur if another session deletes the row.**

5.7 文档对该段落的表述与 8.0 一致，故该机制在 5.7 与 8.0 通用（5.7 未在本机实测，仅比对文档）。

加锁原因：检测到重复时需要确认这条记录是否仍然有效，它可能已被其他事务 delete-mark 但尚未提交。确认过程需要在索引记录上加锁，防止其在判断完成前被修改。

实测 T2 阻塞时，`performance_schema.data_lock_waits` 显示其等待的是一把 **`S` 锁**，加在 `('A001', 1)` 上，即**已被 delete-mark 的旧记录**，而不是 T1 新插入的行。

### 3.3 DELETE 的加锁范围

T1 仅执行 `DELETE FROM t_uk WHERE biz_no='A001'` 后的锁快照：

```
INDEX_NAME   LOCK_MODE        LOCK_STATUS  LOCK_DATA
PRIMARY      X,REC_NOT_GAP    GRANTED      1
uk_biz_no    X,REC_NOT_GAP    GRANTED      'A001', 1
```

仅存在 `REC_NOT_GAP`（记录锁），**没有 gap 锁**。这与文档一致：

> only an index record lock is required for statements that lock rows using a unique index to search for a unique row.

等值命中唯一索引时，InnoDB 将 next-key lock 优化为纯记录锁，因此该键前后的间隙对其它会话开放。实测在 T1 删除未提交期间，T2 插入同间隙内的**另一个键** `'A003'` 立即成功、不阻塞。

需明确区分：**插入「别的键」不受阻，插入「同一个键」才会阻塞。** 造成阻塞的是 `DELETE` 加在该记录上的 `X,REC_NOT_GAP`，并非间隙。

T1 继续执行 `INSERT ('A001',1)` 且不提交，锁变为：

```
INDEX_NAME   LOCK_MODE        LOCK_STATUS  LOCK_DATA
PRIMARY      X,REC_NOT_GAP    GRANTED      1
uk_biz_no    X,REC_NOT_GAP    GRANTED      'A001', 1
uk_biz_no    S,GAP             GRANTED      'A001', 1
uk_biz_no    S,GAP             GRANTED      'A001', 2
uk_biz_no    S                 GRANTED      supremum pseudo-record
```

新增的 `S` / `S,GAP` 由重复键检查产生。T2 此时插入 `A001`，与这些共享锁冲突，只能排队。

需要纠正一个易得的错误因果：**「因为 DELETE 未锁 gap，所以并发插入成功，所以冲突」这一推理不成立。** 间隙开放只影响插入别的键，而 1062 针对插入同一个键。实测在 T1 仅执行 `DELETE`（尚未 `INSERT`）时，T2 插入同键 `A001` 即已阻塞。准确表述为：**删除操作没有释放该键值上的锁，只是将行标记为已删除；同键插入需要检查这条记录，因此必然排队等待。**

（补充：若 `DELETE` 使用非唯一条件，如 `WHERE status=0 AND biz_no BETWEEN 'A002' AND 'A003'`，RR 下会加 next-key lock / gap lock，实测会在 `'A002'` 上留下 `X,GAP`。但这影响的是范围插入的并发度，与本处 1062 的成因无关。）

### 3.4 delete-mark 与 purge

InnoDB 的 `DELETE` 是标记删除（delete-mark），而非物理删除。记录仍保留在聚簇索引与二级索引中，仅打上标记，待后台 purge 线程确认「没有任何活跃 Read View 需要看到它」后才真正清理。

因此存在窗口期：索引上同时存在一条 delete-mark 的旧记录和一条同键的新记录。唯一性检查必须正确处理「旧记录已失效」的情况，不能简单地见同键即报错，而需先判断旧记录状态，该判断过程需要加锁，即 3.3 节中的 `S` 锁。

需标注：**purge 延迟本身能否单独导致 1062，本组实验未能隔离验证。** 在构造的长事务场景中，表中始终存在 T1 已提交的新行，该次 1062 可由正常唯一冲突解释，无法归因于 purge。因此 purge 在此仅作机制解释，不作为独立结论。

### 3.5 死锁

共享锁之间互斥等待，该场景可能升级为死锁。官方文档给出的三会话版本：

```
S1: DELETE WHERE i = 1;              -- 持 X 锁
S2: INSERT (1);                      -- 重复键，请求 S 锁，排队
S3: INSERT (1);                      -- 重复键，请求 S 锁，排队
S1: COMMIT;                          -- S2、S3 各自拿到 S 锁
                                     -- 但插入还需 X 锁，互等 → 死锁
```

本机使用主键表复现：S2 成功，S3 返回

```
ERROR 1213 (40001): Deadlock found when trying to get lock; try restarting transaction
```

`SHOW ENGINE INNODB STATUS` 显示两者均以 `lock mode S locks rec but not gap` 持有、`lock_mode X locks rec but not gap` 等待。

在带唯一二级索引的 `t_uk` 上执行「各删各键、再各插各键」，多次重跑结果在 **1213 死锁** 与 **1205 锁等待超时** 之间摆动，取决于两端的到达顺序。因此线上不一定表现为 1062，也可能是 1213 或 1205。

另一个细节：**报 1062 后若不回滚，该 `S` 锁会持有到事务结束。** 实测 T2 失败后仍持有 `('A001',1)` 和 `('A001',2)` 上的两把 `S` 锁；若捕获异常后继续执行，将扩大锁冲突范围。

### 3.6 版本差异

| 事项 | 5.7 | 8.0 |
| --- | --- | --- |
| 1062 报错中的 key 名 | `for key 'uk_biz_no'` | `for key 't_uk.uk_biz_no'`（带表名） |
| 重复键加共享锁 | 文档表述相同 | 文档表述相同，8.0.46 实测确认 |
| 等值唯一索引 DELETE 的锁 | 仅记录锁（`REC_NOT_GAP`） | 实测确认 |
| 查看锁的视图 | `information_schema.INNODB_LOCKS` | `performance_schema.data_locks`（8.0 已移除前者） |
| `innodb_locks_unsafe_for_binlog` | 存在但已废弃 | 已移除 |

除第一行外，其余各项在两版文档中表述一致，机制层面可视为通用。但**本机只实测了 8.0.46**，5.7 的结论来自官方文档比对，未做运行时验证。

## 四、解决方案与规避建议

以下按改动成本由低到高排列。

### 4.1 修正 DELETE 的定位条件

若 `DELETE` 使用此前查询得到的主键，在高并发下该主键可能已失效：

```sql
-- 反例：id 为此前查询所得
DELETE FROM t_uk WHERE id = 105;   -- 影响 0 行（该行已被删除）
INSERT INTO t_uk (biz_no, status) VALUES ('A001', 2);   -- 1062
```

实测：以旧主键删除影响 0 行，随后 `INSERT` 报 1062；改用唯一键删除：

```sql
DELETE FROM t_uk WHERE biz_no = 'A001';   -- 影响 1 行（当前读定位到新行）
INSERT INTO t_uk (biz_no, status) VALUES ('A001', 2);   -- 成功
```

区别在于：按唯一键定位为当前读，能定位并删除其它事务刚插入的行；按旧主键定位依赖快照中可能已作废的值。前提是 `biz_no` 上确实存在唯一索引，否则 `DELETE` 会退化为范围扫描，锁范围增大。

### 4.2 先占位再删增

若业务要求该键由当前事务独占处理，可先用加锁读占位：

```sql
BEGIN;
SELECT id FROM t_uk WHERE biz_no = 'A001' FOR UPDATE;
DELETE FROM t_uk WHERE biz_no = 'A001';
INSERT INTO t_uk (biz_no, status) VALUES ('A001', 1);
COMMIT;
```

**行存在时该方案有效。** 实测：A 先 `FOR UPDATE`（得到 `X,REC_NOT_GAP`），B 的 `FOR UPDATE` 阻塞；A 删增并提交后，B 继续执行，`DELETE` 影响 1 行、`INSERT` 成功，最终仅剩一行。

**行不存在时该方案无效。** `FOR UPDATE` 查询不存在的键时，InnoDB 加的是 `X,GAP`：

```
INDEX_NAME   LOCK_MODE   LOCK_STATUS  LOCK_DATA
uk_biz_no    X,GAP       GRANTED      'A005', 7
```

而 **gap 锁之间互相兼容**，两个会话都能取得同一间隙的 `X,GAP`，互不阻塞。实测两个会话先后对同一不存在的键 `FOR UPDATE`，均立即返回空结果并「占位成功」；随后各自 `INSERT`，一方成功，另一方返回

```
ERROR 1213 (40001): Deadlock found when trying to get lock; try restarting transaction
```

因此「`FOR UPDATE` 占位」仅在**键确实存在**时成立。对「行不存在」的场景，需依赖应用层锁（如 Redis 分布式锁），或让 `INSERT` 直接尝试并在冲突时重试。

### 4.3 谨慎使用 REPLACE 与 upsert

`REPLACE INTO` 在语义上接近「先删后增」，但文档明确指出其**在待替换行上加 next-key lock**，实测锁范围如下：

```
INDEX_NAME   LOCK_MODE        LOCK_DATA
PRIMARY      X,REC_NOT_GAP    '16'
PRIMARY      X,GAP            '17'
PRIMARY      X                supremum pseudo-record
uk_biz_no    X                'A001', 16
uk_biz_no    X,GAP            'A001', 17
uk_biz_no    X                supremum pseudo-record
```

一次 `REPLACE` 的锁范围远超一行。此外其语义为「删除后插入」：实测自增 id 由 16 变为 17，主键改变、生成新行；触发器会多触发一次删除，外键级联可能受牵连。以 `REPLACE` 规避 1062，通常会把可诊断的错误转换为更难排查的问题。

`INSERT ... ON DUPLICATE KEY UPDATE` 的锁行为同样需注意：文档写明**主键冲突加 X 记录锁，唯一键冲突加 X next-key lock**，实测唯一键冲突时 `uk_biz_no` 上取得的是多个 `X` 而非 `X,REC_NOT_GAP`。

其主要风险在**语义**：它是就地 UPDATE，**不产生新行**。实测对方删增并提交后执行 upsert，`status` 被更新为指定值，但 `id` 保持为对方行的 11 不变。若「先删后增」隐含「生成全新行、字段重置、自增 id 重新分配」的要求，upsert 会在不报错的情况下给出「被修改过的旧行」。使用前需确认语义是否匹配。

### 4.4 将 1062 作为正常并发结果处理

若该键的唯一性本应由数据库保证，则 1062 是约束正常工作的结果，不属于缺陷。处理方式：

```java
try {
    // DELETE + INSERT
} catch (DuplicateKeyException e) {
    // 其他会话已抢先插入同键
    // 方案 A：重试整个「删+增」（需限制次数并退避）
    // 方案 B：转为 UPDATE 已存在的行
}
```

两点要求：

- **捕获 1062 后必须回滚或结束事务**，避免持有 `S` 锁继续执行。
- 重试需设置次数上限与随机退避，否则高并发下会形成重试风暴，将偶发冲突放大为雪崩。

### 4.5 缩短事务

purge 需在「没有活跃 Read View 需要看到该 delete-mark 记录」后才能回收。长事务会延长该窗口，使索引中堆积的 delete-mark 记录增多。尽管未能单独实测「purge 滞后 → 1062」的因果链（见 3.4 节标注），但缩短事务没有副作用，且能减少锁持有时间与死锁概率。

具体做法：将「批量查询 → 循环删增」拆分为小事务；避免在单事务内先删除大量行再逐条插回；`innodb_lock_wait_timeout` 不宜设置过大（默认 50 秒，足以将偶发冲突放大为接口超时）。

### 4.6 方案小结

| 做法 | 是否推荐 | 原因 |
| --- | --- | --- |
| `DELETE` 用唯一键定位，不用旧主键 | 推荐 | 当前读可定位并删除新行 |
| `SELECT ... FOR UPDATE` 先占位 | 仅行存在时 | 键不存在时只加 gap 锁，gap 锁互不排斥，无法占住 |
| 捕获 1062 后重试 / 转 UPDATE | 推荐 | 将约束冲突作为正常并发结果处理 |
| 改隔离级别到 RC | 不推荐 | 实测同样 1062，不解决问题 |
| 改用 `REPLACE INTO` | 不推荐 | next-key lock 范围大，且删插语义会改变主键 |
| 用 `ON DUPLICATE KEY UPDATE` 兜底 | 视语义而定 | 唯一键冲突加 X next-key lock；就地更新，不产生新行 |

## 五、结论

问题的核心在于「删除」并未释放键值。`DELETE` 只保证「在本事务视角下该行不可见」，并不保证「该键值归当前事务所有」。唯一索引约束的对象是**键值**而非**行**，而行可以被删除、重新插入并赋予新主键。当以旧主键删除一个已被替换的行时，删除的是一个已不存在的对象，而该键值仍然存在。

由该机制可得三种处理方向：占位（加锁）、接受冲突（重试）、改变语义（upsert）。三者在适用条件下均可行，但均不能建立「删过即等于没有」的假设。

---

**实测环境**：MySQL 8.0.46（官方 Docker 镜像），InnoDB，`REPEATABLE READ`。锁信息取自 `performance_schema.data_locks` / `data_lock_waits`。5.7 相关结论来自官方文档比对，未做运行时验证。
