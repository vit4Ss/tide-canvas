-- AI model icon assets: reusable icons uploaded by administrators.
CREATE TABLE IF NOT EXISTS `ai_icon_asset` (
    `id`          BIGINT        NOT NULL COMMENT 'primary snowflake id',
    `public_id`   CHAR(36)      CHARACTER SET ascii COLLATE ascii_general_ci NOT NULL COMMENT 'public uuid',
    `name`        VARCHAR(128)  NOT NULL COMMENT 'icon name',
    `icon_url`    VARCHAR(1024) NOT NULL COMMENT 'icon url',
    `file_id`     BIGINT        NOT NULL DEFAULT 0 COMMENT 'sys_file id, 0 for manual url',
    `mime_type`   VARCHAR(128)  NOT NULL DEFAULT '' COMMENT 'file mime type',
    `file_size`   BIGINT        NOT NULL DEFAULT 0 COMMENT 'file size in bytes',
    `status`      TINYINT       NOT NULL DEFAULT 1 COMMENT '0 disabled, 1 enabled',
    `sort_order`  INT           NOT NULL DEFAULT 0 COMMENT 'sort order',
    `created_by`  BIGINT        NOT NULL DEFAULT 0 COMMENT 'admin user id',
    `create_time` DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT 'created time',
    `update_time` DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT 'updated time',
    `deleted`     TINYINT       NOT NULL DEFAULT 0 COMMENT 'soft delete flag',
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_ai_icon_public_id` (`public_id`),
    KEY `idx_ai_icon_status_sort` (`status`, `sort_order`),
    KEY `idx_ai_icon_deleted_time` (`deleted`, `create_time`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='AI model icon assets';
