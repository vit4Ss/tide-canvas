-- =============================================================
-- TideCanvas 存量库结构升级脚本（旧生产库 -> 新 DDL，数据保留）
-- =============================================================
-- 目标：用户先导入 Navicat 导出的 sql/tide_canvas.sql（旧 26 表结构 + 数据），
--       再执行本脚本，将旧库结构原地 ALTER 升级到 sql/schema.sql（新最终结构）。
--
-- 本脚本只做 ADD COLUMN / MODIFY COLUMN / ADD INDEX / DROP INDEX(仅索引,非数据)，
-- 不 DROP 任何业务列、不 DROP TABLE、不删除任何数据行。
--
-- 主要升级点：
--   1. 10 张对外表新增 public_id CHAR(36) + uk_public_id（UUID 由 MySQL UUID() 生成,见下方说明）。
--   2. 6 张日志/流水/中间表补齐 update_time（历史行回填为 create_time）。
--   3. ai_handler_config.point_cost: INT -> DECIMAL(10,2)。
--   4. 各表索引对齐 schema.sql 的复合索引（旧库多为单列/异名,按需新增,必要时换名）。
--   5. 新增 4 张 IM 表 + sys_role（旧库已含 sys_role,此处仅 IM 表为全新建表）。
--
-- 适用：MySQL 8.0+。执行前请务必 mysqldump 全库备份（见 migrate-notes.md 回滚建议）。
--
-- ★ public_id 生成说明 ★
--   MySQL 的 `UPDATE t SET public_id = UUID()` 会“逐行”调用 UUID()，每行得到不同值，
--   因此存量行能拿到各自唯一的 UUID（v1 格式,基于时间戳+MAC,唯一性满足；
--   如业务要求严格 v4,可在应用层后续重生成,不影响唯一约束）。
--   本脚本采用先以 NULL 增列、回填、再改 NOT NULL + 加唯一键 的三步法，保证存量库平滑升级。
-- =============================================================

USE tide_canvas;
SET FOREIGN_KEY_CHECKS = 0;
SET NAMES utf8mb4;


-- =============================================================
-- 1. sys_user —— 新增 public_id；新增复合索引 idx_status_create_time / idx_role_id
--    （旧库已有 uk_username / uk_email，无需重建）
-- =============================================================
ALTER TABLE `sys_user`
    ADD COLUMN `public_id` CHAR(36) CHARACTER SET ascii COLLATE ascii_general_ci NULL AFTER `id`;
UPDATE `sys_user` SET `public_id` = UUID() WHERE `public_id` IS NULL;   -- 逐行生成不同 UUID
ALTER TABLE `sys_user`
    MODIFY COLUMN `public_id` CHAR(36) CHARACTER SET ascii COLLATE ascii_general_ci NOT NULL COMMENT '对外公开ID(UUID v4)' AFTER `id`,
    ADD UNIQUE KEY `uk_public_id` (`public_id`);
-- 旧 role 列注释/role_id 注释升级（可选，仅注释，无数据影响）
ALTER TABLE `sys_user`
    MODIFY COLUMN `role` TINYINT NOT NULL DEFAULT 0 COMMENT '角色(冗余缓存;0:普通用户,1:VIP,9:管理员;权威源见role_id)',
    MODIFY COLUMN `role_id` BIGINT DEFAULT NULL COMMENT 'RBAC角色ID(权威源,见sys_role;1=超级管理员)';
-- 新增复合索引（旧库无）
ALTER TABLE `sys_user`
    ADD KEY `idx_status_create_time` (`status`, `create_time`),
    ADD KEY `idx_role_id` (`role_id`);


-- =============================================================
-- 2. canvas_project —— 新增 public_id；索引对齐
--    旧: idx_user_id(user_id) / idx_share_token(share_token) / uk_url_token(已有)
--    新: idx_user_status_time(user_id,status,update_time) / idx_public_status_time(is_public,status,update_time) / idx_share_token
-- =============================================================
ALTER TABLE `canvas_project`
    ADD COLUMN `public_id` CHAR(36) CHARACTER SET ascii COLLATE ascii_general_ci NULL AFTER `id`;
UPDATE `canvas_project` SET `public_id` = UUID() WHERE `public_id` IS NULL;
ALTER TABLE `canvas_project`
    MODIFY COLUMN `public_id` CHAR(36) CHARACTER SET ascii COLLATE ascii_general_ci NOT NULL COMMENT '对外公开ID(UUID v4)' AFTER `id`,
    ADD UNIQUE KEY `uk_public_id` (`public_id`);
-- 旧单列 idx_user_id 升级为复合 idx_user_status_time
ALTER TABLE `canvas_project` DROP INDEX `idx_user_id`;
ALTER TABLE `canvas_project`
    ADD KEY `idx_user_status_time` (`user_id`, `status`, `update_time`),
    ADD KEY `idx_public_status_time` (`is_public`, `status`, `update_time`);
-- idx_share_token 旧库已存在，保持不变（新库同名同列）


-- =============================================================
-- 3. ai_provider —— 仅新增复合索引 idx_status_priority（旧库无任何二级索引）
-- =============================================================
ALTER TABLE `ai_provider`
    ADD KEY `idx_status_priority` (`status`, `priority`);


-- =============================================================
-- 4. ai_model —— 新增 public_id；索引对齐
--    旧: idx_provider_id(provider_id)
--    新: uk_public_id / uk_provider_model(provider_id,model_id) / idx_type_status(type,status)
-- =============================================================
ALTER TABLE `ai_model`
    ADD COLUMN `public_id` CHAR(36) CHARACTER SET ascii COLLATE ascii_general_ci NULL AFTER `id`;
UPDATE `ai_model` SET `public_id` = UUID() WHERE `public_id` IS NULL;
ALTER TABLE `ai_model`
    MODIFY COLUMN `public_id` CHAR(36) CHARACTER SET ascii COLLATE ascii_general_ci NOT NULL COMMENT '对外公开ID(UUID v4)' AFTER `id`,
    ADD UNIQUE KEY `uk_public_id` (`public_id`);
-- cost_per_call 注释升级（类型 DECIMAL(10,4) 旧新一致，仅注释）
ALTER TABLE `ai_model`
    MODIFY COLUMN `cost_per_call` DECIMAL(10,4) DEFAULT 0.0000 COMMENT '单次调用成本(上游USD,管理端参考,用户侧脱敏)';
-- 旧 idx_provider_id 升级为唯一键 uk_provider_model（注意:若旧数据存在 provider_id+model_id 重复,此句会失败,需先去重）
ALTER TABLE `ai_model` DROP INDEX `idx_provider_id`;
ALTER TABLE `ai_model`
    ADD UNIQUE KEY `uk_provider_model` (`provider_id`, `model_id`),
    ADD KEY `idx_type_status` (`type`, `status`);


-- =============================================================
-- 5. ai_handler_config —— point_cost INT -> DECIMAL(10,2)；新增复合索引 idx_status_sort
--    旧: uk_handler_name(已有), point_cost int
--    新: uk_handler_name / idx_status_sort(status,sort_order) / point_cost DECIMAL(10,2)
-- =============================================================
ALTER TABLE `ai_handler_config`
    MODIFY COLUMN `point_cost` DECIMAL(10,2) NOT NULL DEFAULT 18.00 COMMENT '每次调用消耗积分(与ai_model.point_cost统一为DECIMAL)';
ALTER TABLE `ai_handler_config`
    ADD KEY `idx_status_sort` (`status`, `sort_order`);


-- =============================================================
-- 6. ai_task —— 新增 public_id；索引对齐
--    旧: idx_user_id / idx_project_id / idx_status
--    新: uk_public_id / idx_user_status_time(user_id,status,create_time)
--        / idx_project_time(project_id,create_time) / idx_status_create_time(status,create_time)
-- =============================================================
ALTER TABLE `ai_task`
    ADD COLUMN `public_id` CHAR(36) CHARACTER SET ascii COLLATE ascii_general_ci NULL AFTER `id`;
UPDATE `ai_task` SET `public_id` = UUID() WHERE `public_id` IS NULL;
ALTER TABLE `ai_task`
    MODIFY COLUMN `public_id` CHAR(36) CHARACTER SET ascii COLLATE ascii_general_ci NOT NULL COMMENT '对外公开ID(UUID v4)' AFTER `id`,
    ADD UNIQUE KEY `uk_public_id` (`public_id`);
ALTER TABLE `ai_task` DROP INDEX `idx_user_id`;
ALTER TABLE `ai_task` DROP INDEX `idx_project_id`;
ALTER TABLE `ai_task` DROP INDEX `idx_status`;
ALTER TABLE `ai_task`
    ADD KEY `idx_user_status_time` (`user_id`, `status`, `create_time`),
    ADD KEY `idx_project_time` (`project_id`, `create_time`),
    ADD KEY `idx_status_create_time` (`status`, `create_time`);


-- =============================================================
-- 7. ai_generation_log —— 补 update_time；索引对齐
--    旧: idx_task_id / idx_user_id / idx_project_id / idx_operation_type / idx_create_time（均单列）
--    新: idx_task_id / idx_user_time(user_id,create_time) / idx_project_time(project_id,create_time)
--        / idx_operation_time(operation_type,create_time) / idx_create_time
-- =============================================================
ALTER TABLE `ai_generation_log`
    ADD COLUMN `update_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间' AFTER `create_time`;
UPDATE `ai_generation_log` SET `update_time` = `create_time`;   -- 历史行对齐创建时间
-- 单列索引升级为复合索引（idx_task_id / idx_create_time 旧新同名同列,保留不动）
ALTER TABLE `ai_generation_log` DROP INDEX `idx_user_id`;
ALTER TABLE `ai_generation_log` DROP INDEX `idx_project_id`;
ALTER TABLE `ai_generation_log` DROP INDEX `idx_operation_type`;
ALTER TABLE `ai_generation_log`
    ADD KEY `idx_user_time` (`user_id`, `create_time`),
    ADD KEY `idx_project_time` (`project_id`, `create_time`),
    ADD KEY `idx_operation_time` (`operation_type`, `create_time`);


-- =============================================================
-- 8. redeem_code —— 仅新增复合/补充索引
--    旧: uk_code / idx_status(status) / idx_used_by(used_by)
--    新: uk_code / idx_status_expire_time(status,expire_time) / idx_used_by / idx_batch_no(batch_no)
-- =============================================================
ALTER TABLE `redeem_code` DROP INDEX `idx_status`;
ALTER TABLE `redeem_code`
    ADD KEY `idx_status_expire_time` (`status`, `expire_time`),
    ADD KEY `idx_batch_no` (`batch_no`);
-- idx_used_by 旧库已有，保持不变


-- =============================================================
-- 9. sys_file —— 新增 public_id；索引对齐
--    旧: idx_user_id(user_id) / idx_hash(hash)
--    新: uk_public_id / idx_user_type_time(user_id,file_type,create_time) / idx_hash
-- =============================================================
ALTER TABLE `sys_file`
    ADD COLUMN `public_id` CHAR(36) CHARACTER SET ascii COLLATE ascii_general_ci NULL AFTER `id`;
UPDATE `sys_file` SET `public_id` = UUID() WHERE `public_id` IS NULL;
ALTER TABLE `sys_file`
    MODIFY COLUMN `public_id` CHAR(36) CHARACTER SET ascii COLLATE ascii_general_ci NOT NULL COMMENT '对外公开ID(UUID v4)' AFTER `id`,
    ADD UNIQUE KEY `uk_public_id` (`public_id`);
ALTER TABLE `sys_file` DROP INDEX `idx_user_id`;
ALTER TABLE `sys_file`
    ADD KEY `idx_user_type_time` (`user_id`, `file_type`, `create_time`);
-- idx_hash 旧库已有，保持不变


-- =============================================================
-- 10. sys_banner —— 仅新增复合索引 idx_status_sort（旧库无二级索引）
-- =============================================================
ALTER TABLE `sys_banner`
    ADD KEY `idx_status_sort` (`status`, `sort_order`);


-- =============================================================
-- 11. sys_config —— 结构一致（仅 uk_config_key），无需改动
-- =============================================================
-- 无差异


-- =============================================================
-- 12. email_template —— 新增 idx_enabled（旧库仅 uk_template_code）
-- =============================================================
ALTER TABLE `email_template`
    ADD KEY `idx_enabled` (`enabled`);


-- =============================================================
-- 13. sys_log —— 补 update_time；新增复合索引 idx_action_time
--    旧: idx_user_id / idx_create_time
--    新: idx_user_id / idx_action_time(action,create_time) / idx_create_time
-- =============================================================
ALTER TABLE `sys_log`
    ADD COLUMN `update_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间' AFTER `create_time`;
UPDATE `sys_log` SET `update_time` = `create_time`;
ALTER TABLE `sys_log`
    ADD KEY `idx_action_time` (`action`, `create_time`);


-- =============================================================
-- 14. points_transaction —— 新增复合索引 idx_user_time / idx_biz
--    旧: idx_user_id / idx_type / idx_create_time
--    新: idx_user_id / idx_type / idx_user_time(user_id,create_time) / idx_biz(type,biz_id) / idx_create_time
-- =============================================================
ALTER TABLE `points_transaction`
    ADD KEY `idx_user_time` (`user_id`, `create_time`),
    ADD KEY `idx_biz` (`type`, `biz_id`);


-- =============================================================
-- 15. checkin_record —— 结构一致（仅 uk_user_date），无需改动
-- =============================================================
-- 无差异


-- =============================================================
-- 16. community_comment —— 新增 public_id；索引对齐
--    旧: idx_post_id(post_id) / idx_user_id(user_id)
--    新: uk_public_id / idx_post_time(post_id,create_time) / idx_user_id
-- =============================================================
ALTER TABLE `community_comment`
    ADD COLUMN `public_id` CHAR(36) CHARACTER SET ascii COLLATE ascii_general_ci NULL AFTER `id`;
UPDATE `community_comment` SET `public_id` = UUID() WHERE `public_id` IS NULL;
ALTER TABLE `community_comment`
    MODIFY COLUMN `public_id` CHAR(36) CHARACTER SET ascii COLLATE ascii_general_ci NOT NULL COMMENT '对外公开ID(UUID v4)' AFTER `id`,
    ADD UNIQUE KEY `uk_public_id` (`public_id`);
ALTER TABLE `community_comment` DROP INDEX `idx_post_id`;
ALTER TABLE `community_comment`
    ADD KEY `idx_post_time` (`post_id`, `create_time`);
-- idx_user_id 旧库已有，保持不变


-- =============================================================
-- 17. community_like —— 补 update_time（旧库仅 create_time）
--    索引旧新一致: uk_user_target / idx_target
-- =============================================================
ALTER TABLE `community_like`
    ADD COLUMN `update_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间' AFTER `create_time`;
UPDATE `community_like` SET `update_time` = `create_time`;


-- =============================================================
-- 18. community_post —— 新增 public_id；索引对齐
--    旧: idx_user_id / idx_category / idx_create_time
--    新: uk_public_id / idx_user_status_time(user_id,status,create_time)
--        / idx_category_status_time(category,status,create_time) / idx_status_time(status,create_time)
-- =============================================================
ALTER TABLE `community_post`
    ADD COLUMN `public_id` CHAR(36) CHARACTER SET ascii COLLATE ascii_general_ci NULL AFTER `id`;
UPDATE `community_post` SET `public_id` = UUID() WHERE `public_id` IS NULL;
ALTER TABLE `community_post`
    MODIFY COLUMN `public_id` CHAR(36) CHARACTER SET ascii COLLATE ascii_general_ci NOT NULL COMMENT '对外公开ID(UUID v4)' AFTER `id`,
    ADD UNIQUE KEY `uk_public_id` (`public_id`);
ALTER TABLE `community_post` DROP INDEX `idx_user_id`;
ALTER TABLE `community_post` DROP INDEX `idx_category`;
ALTER TABLE `community_post` DROP INDEX `idx_create_time`;
ALTER TABLE `community_post`
    ADD KEY `idx_user_status_time` (`user_id`, `status`, `create_time`),
    ADD KEY `idx_category_status_time` (`category`, `status`, `create_time`),
    ADD KEY `idx_status_time` (`status`, `create_time`);


-- =============================================================
-- 19. blog_post —— 新增 public_id；索引对齐
--    旧: idx_author_id / idx_category / idx_status
--    新: uk_public_id / idx_author_status_time(author_id,status,create_time)
--        / idx_category_status_time(category,status,create_time) / idx_status_time(status,create_time)
-- =============================================================
ALTER TABLE `blog_post`
    ADD COLUMN `public_id` CHAR(36) CHARACTER SET ascii COLLATE ascii_general_ci NULL AFTER `id`;
UPDATE `blog_post` SET `public_id` = UUID() WHERE `public_id` IS NULL;
ALTER TABLE `blog_post`
    MODIFY COLUMN `public_id` CHAR(36) CHARACTER SET ascii COLLATE ascii_general_ci NOT NULL COMMENT '对外公开ID(UUID v4)' AFTER `id`,
    ADD UNIQUE KEY `uk_public_id` (`public_id`);
ALTER TABLE `blog_post` DROP INDEX `idx_author_id`;
ALTER TABLE `blog_post` DROP INDEX `idx_category`;
ALTER TABLE `blog_post` DROP INDEX `idx_status`;
ALTER TABLE `blog_post`
    ADD KEY `idx_author_status_time` (`author_id`, `status`, `create_time`),
    ADD KEY `idx_category_status_time` (`category`, `status`, `create_time`),
    ADD KEY `idx_status_time` (`status`, `create_time`);


-- =============================================================
-- 20. blog_purchase —— 补 update_time（旧库仅 create_time）
--    索引旧新一致: uk_user_blog
-- =============================================================
ALTER TABLE `blog_purchase`
    ADD COLUMN `update_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间' AFTER `create_time`;
UPDATE `blog_purchase` SET `update_time` = `create_time`;


-- =============================================================
-- 21. recharge_order —— 新增 public_id；status 注释补“4:已超时”；索引对齐
--    旧: uk_order_no / idx_user_id / idx_status
--    新: uk_public_id / uk_order_no / idx_user_status_time(user_id,status,create_time)
--        / idx_status_time(status,create_time) / idx_payment_no(payment_no)
-- =============================================================
ALTER TABLE `recharge_order`
    ADD COLUMN `public_id` CHAR(36) CHARACTER SET ascii COLLATE ascii_general_ci NULL AFTER `id`;
UPDATE `recharge_order` SET `public_id` = UUID() WHERE `public_id` IS NULL;
ALTER TABLE `recharge_order`
    MODIFY COLUMN `public_id` CHAR(36) CHARACTER SET ascii COLLATE ascii_general_ci NOT NULL COMMENT '对外公开ID(UUID v4)' AFTER `id`,
    ADD UNIQUE KEY `uk_public_id` (`public_id`);
-- status 注释升级(增加 4:已超时)，类型不变
ALTER TABLE `recharge_order`
    MODIFY COLUMN `status` TINYINT NOT NULL DEFAULT 0 COMMENT '状态(0:待支付,1:已支付,2:已取消,3:已退款,4:已超时)';
ALTER TABLE `recharge_order` DROP INDEX `idx_user_id`;
ALTER TABLE `recharge_order` DROP INDEX `idx_status`;
ALTER TABLE `recharge_order`
    ADD KEY `idx_user_status_time` (`user_id`, `status`, `create_time`),
    ADD KEY `idx_status_time` (`status`, `create_time`),
    ADD KEY `idx_payment_no` (`payment_no`);


-- =============================================================
-- 22. team —— 新增 public_id；索引对齐
--    旧: uk_invite_code / idx_owner_id(owner_id)
--    新: uk_public_id / uk_invite_code / idx_owner_time(owner_id,create_time)
-- =============================================================
ALTER TABLE `team`
    ADD COLUMN `public_id` CHAR(36) CHARACTER SET ascii COLLATE ascii_general_ci NULL AFTER `id`;
UPDATE `team` SET `public_id` = UUID() WHERE `public_id` IS NULL;
ALTER TABLE `team`
    MODIFY COLUMN `public_id` CHAR(36) CHARACTER SET ascii COLLATE ascii_general_ci NOT NULL COMMENT '对外公开ID(UUID v4)' AFTER `id`,
    ADD UNIQUE KEY `uk_public_id` (`public_id`);
ALTER TABLE `team` DROP INDEX `idx_owner_id`;
ALTER TABLE `team`
    ADD KEY `idx_owner_time` (`owner_id`, `create_time`);


-- =============================================================
-- 23. team_member —— 唯一约束口径变更 + 索引对齐
--    旧: uk_user_id(user_id 唯一) / idx_team_id(team_id)
--    新: uk_team_user(team_id,user_id 唯一) / idx_user_id(user_id)
--    说明: 旧库 user_id 全局唯一(一人仅一团队)，新库改为(team_id,user_id)唯一。
--          先删旧唯一键再加新唯一键；旧 idx_team_id 删除，新增 idx_user_id 普通索引。
-- =============================================================
ALTER TABLE `team_member` DROP INDEX `uk_user_id`;
ALTER TABLE `team_member` DROP INDEX `idx_team_id`;
ALTER TABLE `team_member`
    ADD UNIQUE KEY `uk_team_user` (`team_id`, `user_id`),
    ADD KEY `idx_user_id` (`user_id`);


-- =============================================================
-- 24. access_log —— 补 update_time；索引对齐
--    旧: idx_create_time / idx_user_id(user_id) / idx_path(path)
--    新: idx_create_time / idx_user_time(user_id,create_time)
--        / idx_path_time(path,create_time) / idx_status_time(status,create_time)
-- =============================================================
ALTER TABLE `access_log`
    ADD COLUMN `update_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间' AFTER `create_time`;
UPDATE `access_log` SET `update_time` = `create_time`;
ALTER TABLE `access_log` DROP INDEX `idx_user_id`;
ALTER TABLE `access_log` DROP INDEX `idx_path`;
ALTER TABLE `access_log`
    ADD KEY `idx_user_time` (`user_id`, `create_time`),
    ADD KEY `idx_path_time` (`path`, `create_time`),
    ADD KEY `idx_status_time` (`status`, `create_time`);
-- idx_create_time 旧库已有，保持不变


-- =============================================================
-- 25. login_log —— 补 update_time；索引对齐
--    旧: idx_create_time / idx_user_id / idx_username(username)
--    新: idx_create_time / idx_user_id / idx_username_time(username,create_time)
--        / idx_status_time(status,create_time)
-- =============================================================
ALTER TABLE `login_log`
    ADD COLUMN `update_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间' AFTER `create_time`;
UPDATE `login_log` SET `update_time` = `create_time`;
ALTER TABLE `login_log` DROP INDEX `idx_username`;
ALTER TABLE `login_log`
    ADD KEY `idx_username_time` (`username`, `create_time`),
    ADD KEY `idx_status_time` (`status`, `create_time`);
-- idx_create_time / idx_user_id 旧库已有，保持不变


-- =============================================================
-- 26. sys_role —— 结构一致（id / name / code / permissions / builtin / remark / 时间 / deleted，uk_code）
--    旧库已含本表，无结构差异，无需改动。
-- =============================================================
-- 无差异


-- =============================================================
-- 27. IM 模块（旧库不存在，全新建表）
--     im_conversation / im_conversation_member / im_message / im_user_status
--     直接 CREATE TABLE IF NOT EXISTS（与 schema.sql 完全一致）。
-- =============================================================
CREATE TABLE IF NOT EXISTS `im_conversation` (
    `id`                BIGINT       NOT NULL COMMENT '主键(雪花ID,应用层生成)',
    `public_id`         CHAR(36)     CHARACTER SET ascii COLLATE ascii_general_ci NOT NULL COMMENT '对外公开ID(UUID v4)',
    `type`              VARCHAR(16)  NOT NULL COMMENT '会话类型(private:用户私信/support:客服/staff:后台)',
    `title`             VARCHAR(128) DEFAULT NULL COMMENT '会话标题(群/客服会话用,1v1可空)',
    `owner_id`          BIGINT       DEFAULT NULL COMMENT '发起者/群主用户ID',
    `assignee_id`       BIGINT       DEFAULT NULL COMMENT '客服会话:接入客服用户ID',
    `status`            TINYINT      NOT NULL DEFAULT 0 COMMENT '状态(通用0正常;客服:0待接入,1进行中,2已结束)',
    `member_count`      INT          NOT NULL DEFAULT 0 COMMENT '成员数(冗余)',
    `last_message_id`   BIGINT       DEFAULT NULL COMMENT '最后一条消息ID(冗余,列表排序)',
    `last_message_text` VARCHAR(512) DEFAULT NULL COMMENT '最后消息摘要(冗余,列表预览)',
    `last_message_time` DATETIME     DEFAULT NULL COMMENT '最后消息时间(冗余,列表排序)',
    `create_time`       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    `update_time`       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    `deleted`           TINYINT      NOT NULL DEFAULT 0 COMMENT '逻辑删除',
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_public_id` (`public_id`),
    KEY `idx_type_status` (`type`, `status`),
    KEY `idx_assignee` (`assignee_id`),
    KEY `idx_last_message_time` (`last_message_time`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='IM会话表';

CREATE TABLE IF NOT EXISTS `im_conversation_member` (
    `id`                   BIGINT   NOT NULL COMMENT '主键(雪花ID,应用层生成)',
    `conversation_id`      BIGINT   NOT NULL COMMENT '会话ID',
    `user_id`              BIGINT   NOT NULL COMMENT '成员用户ID',
    `role`                 TINYINT  NOT NULL DEFAULT 0 COMMENT '会话内角色(0:成员,1:客服,2:群主)',
    `last_read_message_id` BIGINT   NOT NULL DEFAULT 0 COMMENT '已读到的最后消息ID',
    `unread_count`         INT      NOT NULL DEFAULT 0 COMMENT '未读数(冗余)',
    `muted`                TINYINT  NOT NULL DEFAULT 0 COMMENT '是否免打扰(0否,1是)',
    `removed`              TINYINT  NOT NULL DEFAULT 0 COMMENT '是否已退出(0否,1是)',
    `create_time`          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '加入时间',
    `update_time`          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    `deleted`              TINYINT  NOT NULL DEFAULT 0 COMMENT '逻辑删除',
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_conversation_user` (`conversation_id`, `user_id`),
    KEY `idx_user` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='IM会话成员表';

CREATE TABLE IF NOT EXISTS `im_message` (
    `id`              BIGINT       NOT NULL COMMENT '主键(雪花ID,应用层生成)',
    `public_id`       CHAR(36)     CHARACTER SET ascii COLLATE ascii_general_ci NOT NULL COMMENT '对外公开ID(UUID v4)',
    `conversation_id` BIGINT       NOT NULL COMMENT '会话ID',
    `sender_id`       BIGINT       DEFAULT NULL COMMENT '发送者用户ID(系统消息为空)',
    `content_type`    VARCHAR(16)  NOT NULL DEFAULT 'text' COMMENT '内容类型(text/image/file/system)',
    `content`         TEXT         NOT NULL COMMENT '消息内容(文本/URL)',
    `extra`           JSON         DEFAULT NULL COMMENT '附加元数据(文件名/尺寸/引用等)',
    `status`          TINYINT      NOT NULL DEFAULT 0 COMMENT '状态(0正常,1已撤回)',
    `create_time`     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    `update_time`     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    `deleted`         TINYINT      NOT NULL DEFAULT 0 COMMENT '逻辑删除',
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_public_id` (`public_id`),
    KEY `idx_conversation_time` (`conversation_id`, `create_time`),
    KEY `idx_sender` (`sender_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='IM消息表';

CREATE TABLE IF NOT EXISTS `im_user_status` (
    `id`             BIGINT   NOT NULL COMMENT '主键(雪花ID,应用层生成)',
    `user_id`        BIGINT   NOT NULL COMMENT '用户ID',
    `online`         TINYINT  NOT NULL DEFAULT 0 COMMENT '是否在线(0离线,1在线;以WS连接为准,本字段为落库快照)',
    `last_seen_time` DATETIME DEFAULT NULL COMMENT '最后在线时间(离线后展示用)',
    `create_time`    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    `update_time`    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_user` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='IM用户在线状态表';


SET FOREIGN_KEY_CHECKS = 1;

-- =============================================================
-- 升级完成。建议执行后用 SHOW CREATE TABLE 抽查 sys_user / ai_handler_config /
-- team_member 等是否与 schema.sql 一致；并校验 10 张表 public_id 均非空且唯一。
--
-- 本脚本为 baseline（一次性）。baseline 之后的增量迁移见 sql/migrations/，
-- 按编号顺序执行；切勿再往本文件追加新结构（见 sql/migrations/README.md）。
-- =============================================================
