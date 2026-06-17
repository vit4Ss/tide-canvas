-- =============================================================
-- 迁移 003 | 2026-06-17 | 通知系统 sys_notification
-- -------------------------------------------------------------
-- 功能 : 新增站内通知表 sys_notification（流水表，无 public_id）。
--        关注 / 评论 / 点赞 / 打赏 动作产生通知。
-- 代码 : feat(notification): in-app notifications (commit 3101fb8)
--        打赏(tip)类型见 commit 66626a0——仅新增 type 取值，
--        无表结构变更，故不单独成迁移；type 注释已含 tip。
-- 依赖 : baseline。
-- 幂等 : 是。CREATE TABLE IF NOT EXISTS，可安全重复执行。
-- =============================================================
USE tide_canvas;
SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS `sys_notification` (
    `id`          BIGINT       NOT NULL COMMENT '主键(雪花ID,应用层生成)',
    `receiver_id` BIGINT       NOT NULL COMMENT '收通知者用户ID',
    `actor_id`    BIGINT       NOT NULL COMMENT '触发通知者用户ID',
    `type`        VARCHAR(16)  NOT NULL COMMENT '通知类型(follow/comment/like/tip)',
    `target_type` VARCHAR(16)  NOT NULL DEFAULT '' COMMENT '目标类型(post/blog;关注类为空)',
    `target_id`   BIGINT       NOT NULL DEFAULT 0 COMMENT '目标内容内部主键(0=无目标)',
    `content`     VARCHAR(255) NOT NULL DEFAULT '' COMMENT '通知摘要文案',
    `is_read`     TINYINT      NOT NULL DEFAULT 0 COMMENT '是否已读(0未读,1已读)',
    `create_time` DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    `update_time` DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    PRIMARY KEY (`id`),
    KEY `idx_receiver_time` (`receiver_id`, `create_time`),
    KEY `idx_receiver_read` (`receiver_id`, `is_read`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='站内通知表';
