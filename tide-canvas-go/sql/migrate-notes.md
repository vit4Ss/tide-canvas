# TideCanvas 存量库结构升级说明（migrate.sql）

旧生产库（Navicat 导出 `tide_canvas.sql`，26 表旧结构 + 数据）原地 ALTER 升级到新 DDL（`schema.sql`，30 表最终结构）。数据全程保留，不删表、不删数据行。

---

## 一、完整差异清单（按表）

> 旧库共 26 表；新库共 30 表。新增 4 张 IM 表（`im_conversation` / `im_conversation_member` / `im_message` / `im_user_status`）。
> `sys_role` 旧库已存在且结构一致。
> 共性规律：旧库二级索引基本是**单列、命名不同**；新库统一为**复合索引**。`public_id` / `update_time` 旧库均无。

| # | 表 | public_id | update_time | 字段类型/注释 | 索引差异（旧 → 新） |
|---|----|-----------|-------------|--------------|---------------------|
| 1 | `sys_user` | ➕ 新增 | 已有 | `role`/`role_id` 注释升级 | ➕ `idx_status_create_time`、`idx_role_id`；`uk_username`/`uk_email` 保留 |
| 2 | `canvas_project` | ➕ 新增 | 已有 | — | `idx_user_id` → `idx_user_status_time`；➕ `idx_public_status_time`；`idx_share_token`/`uk_url_token` 保留 |
| 3 | `ai_provider` | 不需要 | 已有 | — | ➕ `idx_status_priority`（旧库无任何二级索引） |
| 4 | `ai_model` | ➕ 新增 | 已有 | `cost_per_call` 注释升级 | `idx_provider_id` → `uk_provider_model`(唯一)；➕ `idx_type_status` |
| 5 | `ai_handler_config` | 不需要 | 已有 | **`point_cost` INT → DECIMAL(10,2)** | ➕ `idx_status_sort`；`uk_handler_name` 保留 |
| 6 | `ai_task` | ➕ 新增 | 已有 | — | `idx_user_id`/`idx_project_id`/`idx_status` → `idx_user_status_time`/`idx_project_time`/`idx_status_create_time` |
| 7 | `ai_generation_log` | 不需要 | ➕ 新增 | — | `idx_user_id`/`idx_project_id`/`idx_operation_type` → `idx_user_time`/`idx_project_time`/`idx_operation_time`；`idx_task_id`/`idx_create_time` 保留 |
| 8 | `redeem_code` | 不需要 | 已有 | — | `idx_status` → `idx_status_expire_time`；➕ `idx_batch_no`；`uk_code`/`idx_used_by` 保留 |
| 9 | `sys_file` | ➕ 新增 | 已有 | — | `idx_user_id` → `idx_user_type_time`；`idx_hash` 保留 |
| 10 | `sys_banner` | 不需要 | 已有 | — | ➕ `idx_status_sort`（旧库无二级索引） |
| 11 | `sys_config` | 不需要 | 已有 | — | 无差异 |
| 12 | `email_template` | 不需要 | 已有 | — | ➕ `idx_enabled`；`uk_template_code` 保留 |
| 13 | `sys_log` | 不需要 | ➕ 新增 | — | ➕ `idx_action_time`；`idx_user_id`/`idx_create_time` 保留 |
| 14 | `points_transaction` | 不需要 | 已有 | — | ➕ `idx_user_time`、`idx_biz`；`idx_user_id`/`idx_type`/`idx_create_time` 保留 |
| 15 | `checkin_record` | 不需要 | 已有 | — | 无差异 |
| 16 | `community_comment` | ➕ 新增 | 已有 | — | `idx_post_id` → `idx_post_time`；`idx_user_id` 保留 |
| 17 | `community_like` | 不需要 | ➕ 新增 | — | `uk_user_target`/`idx_target` 一致 |
| 18 | `community_post` | ➕ 新增 | 已有 | — | `idx_user_id`/`idx_category`/`idx_create_time` → `idx_user_status_time`/`idx_category_status_time`/`idx_status_time` |
| 19 | `blog_post` | ➕ 新增 | 已有 | — | `idx_author_id`/`idx_category`/`idx_status` → `idx_author_status_time`/`idx_category_status_time`/`idx_status_time` |
| 20 | `blog_purchase` | 不需要 | ➕ 新增 | — | `uk_user_blog` 一致 |
| 21 | `recharge_order` | ➕ 新增 | 已有 | `status` 注释加“4:已超时” | `idx_user_id`/`idx_status` → `idx_user_status_time`/`idx_status_time`；➕ `idx_payment_no`；`uk_order_no` 保留 |
| 22 | `team` | ➕ 新增 | 已有 | — | `idx_owner_id` → `idx_owner_time`；`uk_invite_code` 保留 |
| 23 | `team_member` | 不需要 | 已有 | — | **唯一键口径变更**：`uk_user_id(user_id)` → `uk_team_user(team_id,user_id)`；`idx_team_id` → `idx_user_id` |
| 24 | `access_log` | 不需要 | ➕ 新增 | — | `idx_user_id`/`idx_path` → `idx_user_time`/`idx_path_time`；➕ `idx_status_time`；`idx_create_time` 保留 |
| 25 | `login_log` | 不需要 | ➕ 新增 | — | `idx_username` → `idx_username_time`；➕ `idx_status_time`；`idx_create_time`/`idx_user_id` 保留 |
| 26 | `sys_role` | 不需要 | 已有 | — | 无差异（旧库已含） |
| 27 | `im_conversation` | （含） | （含） | — | **全新建表** |
| 28 | `im_conversation_member` | 不需要 | （含） | — | **全新建表** |
| 29 | `im_message` | （含） | （含） | — | **全新建表** |
| 30 | `im_user_status` | 不需要 | （含） | — | **全新建表** |

**汇总：**
- **新增 `public_id`（10 张）**：`sys_user`、`canvas_project`、`ai_model`、`ai_task`、`sys_file`、`community_post`、`community_comment`、`blog_post`、`recharge_order`、`team`。
- **新增 `update_time`（6 张）**：`access_log`、`login_log`、`sys_log`、`ai_generation_log`、`community_like`、`blog_purchase`。
- **字段类型改动（1 处）**：`ai_handler_config.point_cost` `INT` → `DECIMAL(10,2)`。
  - 复核结论：其余金额/积分字段旧库已是目标类型，无需改动——`ai_model.point_cost` 已 `DECIMAL(10,2)`、`ai_model.cost_per_call` 已 `DECIMAL(10,4)`、`ai_task.cost` 已 `DECIMAL(10,4)`、`ai_generation_log.cost` 已 `DECIMAL(10,4)`、`recharge_order.amount` 已 `DECIMAL(10,2)`。
- **唯一键口径变更（1 张）**：`team_member` 由 `user_id` 全局唯一改为 `(team_id, user_id)` 复合唯一。
- **新增表（4 张）**：IM 模块四表。
- **未改动**：`sys_config`、`checkin_record`、`sys_role` 结构一致。

> 说明：旧库 dump 是 `ROW_FORMAT = Dynamic` 且索引带 `USING BTREE`，新 DDL 未显式声明——二者对 InnoDB 等价，migrate.sql 不做调整。表/列 `COMMENT` 的细微文案差异除上表标注的几处外，不影响功能，未逐一同步。

---

## 二、执行流程

1. **备份**（必做，见第四节）。
2. **导入旧库 dump**（得到旧结构 + 7867 行数据）：
   ```bash
   mysql -u root -p < sql/tide_canvas.sql
   ```
   （dump 内含 `CREATE DATABASE` / `USE`，会建好 `tide_canvas` 库并灌数据。）
3. **执行升级脚本**：
   ```bash
   mysql -u root -p tide_canvas < sql/migrate.sql
   ```
4. **校验**：
   ```sql
   -- 10 张表 public_id 应全部非空且唯一（下例计数应等于总行数）
   SELECT COUNT(*) AS total, COUNT(DISTINCT public_id) AS uniq FROM sys_user;
   -- 抽查结构是否与 schema.sql 一致
   SHOW CREATE TABLE ai_handler_config;   -- point_cost 应为 decimal(10,2)
   SHOW CREATE TABLE team_member;         -- 唯一键应为 uk_team_user(team_id,user_id)
   ```

> migrate.sql 头尾已包裹 `SET FOREIGN_KEY_CHECKS=0/1` 与 `SET NAMES utf8mb4`，并 `USE tide_canvas`。可直接整文件执行。

---

## 三、public_id 的生成方式

- 采用 MySQL 内置 `UUID()`。`UPDATE t SET public_id = UUID()` 会**逐行**求值，存量每行得到**各自不同**的 UUID，唯一性满足，可直接挂 `UNIQUE KEY`。
- `UUID()` 产出的是 **v1 格式**（时间戳 + 节点），并非 schema.sql 注释所写的 v4（随机）。对“对外不可枚举、全局唯一”的用途已足够；若业务严格要求 v4：
  - 升级后在应用层（Go `pkg` 层）对存量行重新生成 v4 覆盖，或
  - 用 MySQL 8 的随机字节自拼 v4（较繁琐，不推荐在迁移脚本里做）。
- 升级采用 **三步法**：先 `NULL` 增列 → `UPDATE` 回填 → 改 `NOT NULL` 并加 `uk_public_id`。避免“给非空表直接加 NOT NULL 无默认值列”报错。
- 列定义与 schema.sql 完全一致：`CHAR(36) CHARACTER SET ascii COLLATE ascii_general_ci`，位置 `AFTER id`。

---

## 四、回滚建议

1. **迁移前整库备份**（强烈建议，最稳妥）：
   ```bash
   mysqldump -u root -p --single-transaction --routines --triggers tide_canvas > backup_tide_canvas_$(date +%Y%m%d_%H%M).sql
   ```
   出问题直接 `DROP DATABASE tide_canvas; CREATE DATABASE ...;` 后回灌备份即可。
2. 本脚本**不删数据**，回滚风险点仅在结构层。如需手工逆操作，可按表 `DROP COLUMN public_id` / `DROP COLUMN update_time` / 还原索引名，但工作量大且易遗漏——**优先用整库备份回滚**。
3. 建议在与生产同版本的 MySQL 8 上先用 dump 演练一遍 migrate.sql，确认零报错后再上生产。

---

## 五、不确定点 / 执行前需注意

1. **`ai_model` 唯一键 `uk_provider_model(provider_id, model_id)`**：若旧数据中存在同 `provider_id` + `model_id` 的重复行，`ADD UNIQUE KEY` 会失败。当前 dump 中 3 行 `ai_model` 的 `model_id` 各不相同（`gpt-image-2` / `kling-video-3-standard-runware` / `midjourney`，同一 provider），不会冲突；但**生产真实数据需确认无重复**，否则先去重。
2. **`team_member` 唯一键变更**：旧库 `user_id` 全局唯一（一人仅属一个团队）。改为 `(team_id, user_id)` 后语义放宽为“一人可属多团队”。当前 dump 中 `team_member` 无数据，零风险；生产若有数据，理论上旧约束更严，转新约束不会冲突。
3. **索引 DROP/ADD 不可重入**：MySQL 不支持 `ADD INDEX IF NOT EXISTS` / `DROP INDEX IF EXISTS`。本脚本假定库结构与所给 dump **完全一致**时**只执行一次**。若中途失败重跑，已成功的 `DROP`/`ADD` 会因索引不存在/已存在而报错——重跑前需人工核对断点，或回滚到备份重新来过。
4. **`canvas_project.idx_public_status_time`**：旧库无此索引，直接 ADD 不冲突。
5. 表/列 `COMMENT` 仅同步了影响理解的关键几处（`point_cost`、`role`、`recharge_order.status` 等）；其余纯文案差异未同步，不影响运行。如需 100% 对齐注释，可后续用 schema.sql 全量 `SHOW CREATE TABLE` 比对补齐。
6. 旧 dump 的 `ROW_FORMAT=Dynamic` 在升级后保留（ALTER 不改变行格式），与新 DDL 默认行格式对 InnoDB 等价，无需处理。
