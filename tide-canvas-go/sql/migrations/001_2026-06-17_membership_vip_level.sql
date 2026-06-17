-- =============================================================
-- 迁移 001 | 2026-06-17 | 会员等级 vip_level
-- -------------------------------------------------------------
-- 功能 : sys_user 增加会员等级字段 vip_level；并把旧 VIP(role=1)
--        的数据迁移为 普通用户(role=0) + 会员等级 2。
-- 背景 : 角色简化为 0=普通/9=管理员，会员身份改由 vip_level 表达
--        （1 起，等级越高 AI 并发越大，档位后台可配）。
-- 代码 : feat(user): membership tier vip_level (commit 9a772be)
-- 依赖 : baseline（migrate.sql 或 schema.sql 已建好 sys_user）。
-- 幂等 : 否。ADD COLUMN 无 IF NOT EXISTS，重复执行会报
--        "Duplicate column name 'vip_level'"。已执行过请勿重跑。
-- =============================================================
USE tide_canvas;
SET NAMES utf8mb4;

ALTER TABLE `sys_user`
    ADD COLUMN `vip_level` INT NOT NULL DEFAULT 1 COMMENT '会员等级(1起)' AFTER `role`;

UPDATE `sys_user` SET `vip_level` = 2, `role` = 0 WHERE `role` = 1;
