-- 013: 管理员资源表与用户素材表物理隔离。
-- 说明:
--   - sys_file 只保存用户侧素材库资源。
--   - sys_admin_file 保存后台配置类资源，例如画布助手宠物样式图片。
--   - 已误入 sys_file 的管理员宠物精灵图迁入 sys_admin_file，并软删除原用户素材记录。

CREATE TABLE IF NOT EXISTS `sys_admin_file` (
    `id`            BIGINT       NOT NULL COMMENT '主键(雪花ID,应用层生成)',
    `public_id`     CHAR(36)     CHARACTER SET ascii COLLATE ascii_general_ci NOT NULL COMMENT '对外公开ID(UUID v4)',
    `admin_id`      BIGINT       NOT NULL DEFAULT 0 COMMENT '管理员用户ID',
    `biz_type`      VARCHAR(64)  NOT NULL DEFAULT 'system' COMMENT '业务类型(assistant_pet等)',
    `original_name` VARCHAR(255) NOT NULL COMMENT '原始文件名',
    `stored_name`   VARCHAR(255) NOT NULL COMMENT '存储文件名',
    `file_path`     VARCHAR(512) NOT NULL COMMENT '存储路径',
    `file_url`      VARCHAR(512) NOT NULL COMMENT '访问URL',
    `file_size`     BIGINT       NOT NULL DEFAULT 0 COMMENT '文件大小(bytes)',
    `file_type`     VARCHAR(16)  NOT NULL COMMENT '文件类型(image/video/other)',
    `mime_type`     VARCHAR(128) DEFAULT NULL COMMENT 'MIME类型',
    `hash`          VARCHAR(64)  DEFAULT NULL COMMENT 'SHA-256哈希',
    `storage_type`  VARCHAR(16)  NOT NULL DEFAULT 'local' COMMENT '存储方式(local/oss)',
    `create_time`   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    `update_time`   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    `deleted`       TINYINT      NOT NULL DEFAULT 0 COMMENT '逻辑删除',
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_admin_file_public_id` (`public_id`),
    KEY `idx_admin_biz_time` (`admin_id`, `biz_type`, `create_time`),
    KEY `idx_file_url` (`file_url`(191)),
    KEY `idx_deleted_time` (`deleted`, `create_time`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='管理员资源表';

INSERT IGNORE INTO `sys_admin_file` (
    `id`,
    `public_id`,
    `admin_id`,
    `biz_type`,
    `original_name`,
    `stored_name`,
    `file_path`,
    `file_url`,
    `file_size`,
    `file_type`,
    `mime_type`,
    `hash`,
    `storage_type`,
    `create_time`,
    `update_time`,
    `deleted`
)
SELECT
    f.`id`,
    UUID(),
    f.`user_id`,
    'assistant_pet',
    f.`original_name`,
    f.`stored_name`,
    f.`file_path`,
    f.`file_url`,
    f.`file_size`,
    f.`file_type`,
    f.`mime_type`,
    f.`hash`,
    f.`storage_type`,
    f.`create_time`,
    f.`update_time`,
    0
FROM `sys_file` f
JOIN `sys_user` u ON u.`id` = f.`user_id`
WHERE f.`deleted` = 0
  AND u.`role` = 9
  AND f.`file_type` = 'image'
  AND (
      f.`original_name` = 'spritesheet.webp'
      OR EXISTS (
          SELECT 1
          FROM `sys_config` c
          WHERE c.`config_key` = 'canvas.assistant.petStyles'
            AND LOCATE(f.`file_url`, c.`config_value`) > 0
      )
  );

UPDATE `sys_file` f
JOIN `sys_user` u ON u.`id` = f.`user_id`
SET f.`deleted` = 1,
    f.`update_time` = CURRENT_TIMESTAMP
WHERE f.`deleted` = 0
  AND u.`role` = 9
  AND f.`file_type` = 'image'
  AND (
      f.`original_name` = 'spritesheet.webp'
      OR EXISTS (
          SELECT 1
          FROM `sys_config` c
          WHERE c.`config_key` = 'canvas.assistant.petStyles'
            AND LOCATE(f.`file_url`, c.`config_value`) > 0
      )
  );
