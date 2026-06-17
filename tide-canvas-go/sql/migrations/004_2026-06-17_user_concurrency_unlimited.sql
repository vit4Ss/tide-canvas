-- =============================================================
-- 迁移 004 | 2026-06-17 | 用户级免 AI 并发限制 concurrency_unlimited
-- -------------------------------------------------------------
-- 功能 : sys_user 增加用户级开关 concurrency_unlimited，置 1 的
--        用户不受 AI 并发上限约束（取代原全局并发白名单
--        ai.concurrency_whitelist）。
-- 背景 : 并发豁免由「全局用户名白名单」改为「每用户布尔开关」，
--        在后台用户编辑界面设置；管理员(role=9)仍始终豁免，
--        其余用户按会员等级 vip_level 的并发上限限制。
-- 代码 : feat(user): per-user concurrency_unlimited switch
-- 依赖 : 迁移 001（sys_user.vip_level 已存在；本列加在其后）。
-- 幂等 : 否。ADD COLUMN 无 IF NOT EXISTS，重复执行会报
--        "Duplicate column name 'concurrency_unlimited'"。已执行过请勿重跑。
-- =============================================================
USE tide_canvas;
SET NAMES utf8mb4;

ALTER TABLE `sys_user`
    ADD COLUMN `concurrency_unlimited` TINYINT NOT NULL DEFAULT 0 COMMENT '免AI并发限制(0否1是)' AFTER `vip_level`;
