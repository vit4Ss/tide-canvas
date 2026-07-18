-- Track which administrator added each upstream model.
ALTER TABLE `ai_upstream_model`
    ADD COLUMN `created_by` BIGINT NOT NULL DEFAULT 0 COMMENT 'admin user id' AFTER `status`,
    ADD KEY `idx_upstream_creator_time` (`created_by`, `create_time`);
