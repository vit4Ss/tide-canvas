-- ============================================================
-- 迁移脚本：兑换码表新增「生成者(管理员)用户ID」字段
-- 用于已部署的生产库，执行一次即可（MySQL 不支持 ADD COLUMN IF NOT EXISTS，请勿重复执行）
-- ============================================================

ALTER TABLE `redeem_code`
    ADD COLUMN `created_by` BIGINT DEFAULT NULL COMMENT '生成者(管理员)用户ID' AFTER `points`;
