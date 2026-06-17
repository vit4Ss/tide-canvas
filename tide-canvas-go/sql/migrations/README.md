# 数据库 SQL 脚本说明

本项目 SQL 分三类，按场景使用，互不重复执行：

| 文件 | 用途 | 何时执行 |
|---|---|---|
| `../schema.sql` | 全新库**全量** DDL（已含所有最新表 / 列 / 索引） | 全新部署，执行一次 |
| `../migrate.sql` | **baseline**：旧 Java 生产库一次性升级到 Go 初始结构（26 业务表 + 4 张 IM 表） | 仅「从旧库升级」时执行一次 |
| `migrations/NNN_*.sql` | baseline 之后的**增量迁移**，每个功能 / 批次一个文件 | 存量库按编号顺序逐个执行 |

> 全新部署只跑 `schema.sql` 即可，**无需**再跑本目录任何迁移（schema.sql 已是最新全量）。
> 本目录迁移只用于「已经按 baseline 跑起来、需要逐步追加新结构」的存量库。

## 命名规范

`<3 位序号>_<日期>_<短描述>.sql`，例：`001_2026-06-17_membership_vip_level.sql`

每个迁移文件**头部注释必须写明**：功能 / 对应代码提交 / 依赖 / 是否幂等 / 能否重复执行。

## 现有增量（baseline 之后按序执行）

| 序号 | 文件 | 内容 | 幂等 |
|---|---|---|---|
| 001 | `001_2026-06-17_membership_vip_level.sql` | `sys_user.vip_level` 列 + 旧 VIP 数据迁移 | 否 |
| 002 | `002_2026-06-17_follow_system.sql` | `sys_follow` 关注关系表 | 是 |
| 003 | `003_2026-06-17_notification_system.sql` | `sys_notification` 站内通知表 | 是 |
| 004 | `004_2026-06-17_user_concurrency_unlimited.sql` | `sys_user.concurrency_unlimited` 列（用户级免 AI 并发限制） | 否 |

## 约定（重要）

- 以后**每次** schema 变更都**新建**一个递增编号文件，**不要**往旧文件或 `migrate.sql` 追加，避免分不清执行进度。
- 文件一经提交（可能已在某环境执行过）即视为**不可变**；要修正只能再加一个新迁移。
- 可选的执行台账：在生产建一张
  `schema_migration(version VARCHAR(64) PRIMARY KEY, applied_at DATETIME DEFAULT CURRENT_TIMESTAMP)`，
  每执行完一个迁移就 `INSERT INTO schema_migration(version) VALUES ('001');`，
  作为「已执行哪些」的权威记录。需要的话可以补这张表 + 各迁移末尾的 INSERT。
