-- =============================================================
-- 迁移 002 | 2026-06-17 | 关注系统 sys_follow
-- -------------------------------------------------------------
-- 功能 : 新增关注关系表 sys_follow（中间表，无 public_id）。
--        (follower_id, followee_id) 唯一，禁止重复关注。
-- 代码 : feat(follow): follow system (commit 079b4fd)
-- 依赖 : baseline。
-- 幂等 : 是。CREATE TABLE IF NOT EXISTS，可安全重复执行。
-- =============================================================
USE tide_canvas;
SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS `sys_follow` (
    `id`          BIGINT   NOT NULL COMMENT '主键(雪花ID,应用层生成)',
    `follower_id` BIGINT   NOT NULL COMMENT '关注者用户ID',
    `followee_id` BIGINT   NOT NULL COMMENT '被关注者用户ID',
    `create_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    `update_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_follower_followee` (`follower_id`, `followee_id`),
    KEY `idx_followee` (`followee_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='关注关系表';
