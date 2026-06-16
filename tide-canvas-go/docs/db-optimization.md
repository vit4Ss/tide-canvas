# 数据库优化说明

本文档记录 `sql/schema.sql` 相对旧版（`../tide-canvas-server/sql/init.sql` + 各 `migration_*.sql`）所做的优化，以及**未应用、需结合业务确认**的可选建议。

## 一、已应用的优化

### 1. 主键策略：雪花ID
- 所有表 `id BIGINT`，由应用层（`pkg/snowflake`）生成，不使用 `AUTO_INCREMENT`。
- 语义与旧版 MyBatis-Plus `IdType.ASSIGN_ID` 一致；Go 侧由 `internal/model` 的 `BeforeCreate` 钩子注入。
- 种子数据的 `id` 用固定小整数占位（如 admin=1），便于跨环境引用，与运行期雪花ID 不冲突。

### 2. 对外公开ID：`public_id`（UUID v4）
- **原则**：对外只暴露 `public_id`，绝不把雪花/自增主键暴露给前端或外链，防止资源枚举与业务规模探测。
- **类型**：`CHAR(36)`，单列 `ascii` 字符集（UUID 全为 ASCII，省空间、比对更快），唯一索引 `uk_public_id`。
- **加 `public_id` 的 10 张表**：

  | 表 | 对外场景 |
  | --- | --- |
  | `sys_user` | 用户主页 / 作者引用 |
  | `canvas_project` | 画布资源 |
  | `ai_task` | 前端轮询任务状态 |
  | `sys_file` | 文件资源对外访问 |
  | `community_post` | 社区帖子 |
  | `community_comment` | 评论引用 |
  | `blog_post` | 博客文章 |
  | `recharge_order` | 订单详情 |
  | `team` | 团队资源 |
  | `ai_model` | 前端选择模型时引用 |

- **不加的表及原因**：
  - 日志 / 流水 / 中间表（`access_log`、`login_log`、`sys_log`、`ai_generation_log`、`points_transaction`、`checkin_record`、`community_like`、`blog_purchase`、`team_member`）——纯内部，不对外暴露单条记录。
  - 自身标识/凭证即对外的表（`redeem_code.code`、`sys_config.config_key`、`email_template.template_code`、`sys_role.code`）。
  - 敏感或管理端专用（`ai_provider` 含加密密钥、`ai_handler_config`、`sys_banner`）。

> 注：`canvas_project.url_token`/`share_token`、`team.invite_code`、`recharge_order.order_no` 等既有不透明标识予以**保留**，与新增的 `public_id` 职责不同（前者面向特定链接/对账场景，后者为统一的资源对外主键）。

### 3. 时间戳统一
- 所有表统一含 `create_time` + `update_time`。
- 旧版仅有 `create_time` 的 6 张表已补 `update_time`：`access_log`、`login_log`、`sys_log`、`ai_generation_log`、`community_like`、`blog_purchase`。
- 说明：纯追加型日志的 `update_time` 实际很少变动，此处按「所有表统一含双时间戳」的规范补齐（你的明确要求）。

### 4. 结构规范化
- **字段顺序统一**：`id` → `public_id`(如有) → 业务字段 → `create_time` → `update_time` → `deleted`(如有)。
- **collation 升级**：`utf8mb4_general_ci` → `utf8mb4_0900_ai_ci`（MySQL 8 默认，Unicode 9.0 排序规则，比对更准）。
- **建表与种子分区**：先集中建表，再统一插入种子数据（旧版穿插在表之间），可读性更好。
- 注释、对齐、类型保持与旧版一致，未改动既有列的类型与业务语义。

### 5. 高频查询复合索引
- 面向列表页、后台筛选、任务轮询、日志检索补齐了复合索引，减少单列索引交叉和回表成本。
- 重点索引：
  - `canvas_project.idx_user_status_time`、`idx_public_status_time`：我的项目、公开项目列表。
  - `ai_task.idx_user_status_time`、`idx_status_create_time`：我的任务列表、后台/worker 按状态扫描。
  - `points_transaction.idx_user_time`、`idx_biz`：用户积分流水和业务幂等追踪。
  - `blog_post.idx_status_time`、`idx_author_status_time`、`idx_category_status_time`：公开列表、作者后台、分类筛选。
  - `access_log.idx_path_time`、`idx_status_time`、`login_log.idx_username_time`：后台审计检索。
- 单列索引保留在确实需要单列过滤或兼容旧查询的表上；能被复合索引左前缀覆盖的路径已尽量合并。

### 6. 社区与博客（自研）
- 社区功能**自研**（Gin + GORM），保留 `community_post`、`community_comment`、`community_like` 三表，不引入外部 bbs-go——规避 Iris/Gin 框架冲突与 GPLv3 许可传染，且技术栈统一。
- `community_like` 为**通用点赞表**，`target_type` 区分 帖子(1)/评论(2)/博客(3)，博客点赞复用此表（不单设 blog_like）。
- 博客相关（`blog_post`、`blog_purchase`）与社区同属内容域，分表管理。
- 全库共 26 张表。

## 二、可选建议（未应用，需结合业务确认）

> 以下均会改变现有行为或查询计划，故本版**未擅自改动**，留作上线前评估。

### A. 逻辑删除与唯一索引冲突 ⚠️（建议优先评估）
- **现状**：`sys_user` 有 `uk_username` / `uk_email` 唯一索引 + `deleted` 逻辑删除。
- **问题**：用户被逻辑删除后，其 `username` / `email` 仍占用唯一约束，无法被新用户复用。
- **可选方案**：
  1. 唯一索引纳入 `deleted`，如 `uk_email (email, deleted)`——但 `deleted` 仅 0/1，同一值只能软删一次。
  2. 删除时把 `email`/`username` 改写为墓碑值（如 `email#<id>`），由应用层处理。
  3. 将 `deleted` 改为 `deleted_at`（DATETIME，NULL=未删），唯一索引用 `(email, deleted_at)`，可多次软删——改动最干净，但需同步调整模型与查询。
- 同类影响：`sys_role.uk_code`、`redeem_code.uk_code`、`team.uk_invite_code` 等。

### B. 富文本内容安全与存储
- 社区/博客 `content` 为用户富文本，入库前需做 XSS 清洗（已选型 `bluemonday`）。
- 大体量富文本可考虑与主表分离按需加载（见 C）；当前未拆。

### C. 大字段冷热分离
- `canvas_project.canvas_data`、`community_post.content`、`blog_post.content`（均 LONGTEXT）与主表同表，列表查询易误带大字段。
- 可拆分为 `*_content` 子表按需加载；本版未拆（涉及读写路径改造）。

### D. 日志表归档
- `access_log`、`ai_generation_log` 增长较快，建议按时间分区或定期归档冷数据，避免主表膨胀拖慢统计。

## 三、与旧版 DDL 对照
- 旧版（权威参照）：`../tide-canvas-server/sql/init.sql`（26 表）+ `migration_*.sql`（增量补丁）。
- 本版：`sql/schema.sql`，已合并所有 migration 的最终态，并应用上述「已应用的优化」。
