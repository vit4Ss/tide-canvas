-- Persistent AI creation conversations, message branches, file references, and
-- extracted document chunks.

ALTER TABLE `ai_model`
    ADD COLUMN `capabilities` JSON DEFAULT NULL COMMENT 'user-facing model capabilities' AFTER `supported_handlers`;

CREATE TABLE IF NOT EXISTS `ai_conversation` (
    `id`                     BIGINT       NOT NULL COMMENT 'primary snowflake id',
    `public_id`              CHAR(36)     CHARACTER SET ascii COLLATE ascii_general_ci NOT NULL COMMENT 'public UUID',
    `user_id`                BIGINT       NOT NULL COMMENT 'owner sys_user.id',
    `mode`                   VARCHAR(16)  NOT NULL COMMENT 'text/image/video',
    `title`                  VARCHAR(120) NOT NULL DEFAULT '新对话',
    `pinned`                 TINYINT      NOT NULL DEFAULT 0,
    `active_leaf_message_id` BIGINT       DEFAULT NULL COMMENT 'active branch leaf message id',
    `last_message_time`      DATETIME     DEFAULT NULL,
    `create_time`            DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `update_time`            DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    `deleted`                TINYINT      NOT NULL DEFAULT 0,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_ai_conversation_public_id` (`public_id`),
    KEY `idx_ai_conversation_user_recent` (`user_id`, `pinned`, `last_message_time`),
    KEY `idx_ai_conversation_user_mode` (`user_id`, `mode`, `update_time`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='AI creation conversation';

CREATE TABLE IF NOT EXISTS `ai_conversation_message` (
    `id`                BIGINT        NOT NULL COMMENT 'primary snowflake id',
    `public_id`         CHAR(36)      CHARACTER SET ascii COLLATE ascii_general_ci NOT NULL COMMENT 'public UUID',
    `conversation_id`   BIGINT        NOT NULL COMMENT 'ai_conversation.id',
    `parent_message_id` BIGINT        DEFAULT NULL COMMENT 'previous message in active branch',
    `role`              VARCHAR(16)   NOT NULL COMMENT 'user/assistant/system',
    `content_type`      VARCHAR(16)   NOT NULL DEFAULT 'text' COMMENT 'text/image/video/status',
    `content`           LONGTEXT      NOT NULL,
    `model_id`          BIGINT        DEFAULT NULL COMMENT 'ai_model.id snapshot relation',
    `model_name`        VARCHAR(128)  NOT NULL DEFAULT '',
    `task_id`           BIGINT        DEFAULT NULL COMMENT 'ai_task.id',
    `status`            VARCHAR(16)   NOT NULL DEFAULT 'done' COMMENT 'pending/streaming/done/error/cancelled',
    `metadata`          JSON          DEFAULT NULL,
    `create_time`       DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `update_time`       DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    `deleted`           TINYINT       NOT NULL DEFAULT 0,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_ai_conversation_message_public_id` (`public_id`),
    KEY `idx_ai_message_conversation_time` (`conversation_id`, `create_time`),
    KEY `idx_ai_message_parent` (`parent_message_id`),
    KEY `idx_ai_message_task` (`task_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='AI conversation message tree';

CREATE TABLE IF NOT EXISTS `ai_message_file` (
    `id`          BIGINT       NOT NULL COMMENT 'primary snowflake id',
    `message_id`  BIGINT       NOT NULL COMMENT 'ai_conversation_message.id',
    `file_id`     BIGINT       NOT NULL COMMENT 'sys_file.id',
    `relation`    VARCHAR(16)  NOT NULL DEFAULT 'attachment' COMMENT 'attachment/result/reference',
    `locator`     JSON         DEFAULT NULL COMMENT 'page/sheet/slide/range metadata',
    `create_time` DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `update_time` DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_ai_message_file_relation` (`message_id`, `file_id`, `relation`),
    KEY `idx_ai_message_file_file` (`file_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='AI message file relation';

CREATE TABLE IF NOT EXISTS `sys_file_reference` (
    `id`          BIGINT       NOT NULL COMMENT 'primary snowflake id',
    `user_id`     BIGINT       NOT NULL COMMENT 'file owner sys_user.id',
    `file_id`     BIGINT       NOT NULL COMMENT 'sys_file.id',
    `biz_type`    VARCHAR(32)  NOT NULL COMMENT 'asset/conversation_temp/message/canvas',
    `biz_id`      BIGINT       NOT NULL COMMENT 'internal business id',
    `create_time` DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `update_time` DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_sys_file_reference` (`file_id`, `biz_type`, `biz_id`),
    KEY `idx_sys_file_reference_user` (`user_id`, `biz_type`, `create_time`),
    KEY `idx_sys_file_reference_biz` (`biz_type`, `biz_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='Physical file business references';

-- Existing sys_file rows are user assets. Backfill a library reference so the
-- new reference-aware asset list remains backwards compatible.
INSERT IGNORE INTO `sys_file_reference`
    (`id`, `user_id`, `file_id`, `biz_type`, `biz_id`, `create_time`, `update_time`)
SELECT `id`, `user_id`, `id`, 'asset', `id`, `create_time`, `update_time`
FROM `sys_file`
WHERE `deleted` = 0;

CREATE TABLE IF NOT EXISTS `ai_document` (
    `id`             BIGINT       NOT NULL COMMENT 'primary snowflake id',
    `public_id`      CHAR(36)     CHARACTER SET ascii COLLATE ascii_general_ci NOT NULL COMMENT 'public UUID',
    `user_id`        BIGINT       NOT NULL COMMENT 'owner sys_user.id',
    `file_id`        BIGINT       NOT NULL COMMENT 'sys_file.id',
    `status`         VARCHAR(16)  NOT NULL DEFAULT 'pending' COMMENT 'pending/processing/ready/error',
    `page_count`     INT          NOT NULL DEFAULT 0,
    `character_count` BIGINT      NOT NULL DEFAULT 0,
    `error_message`  TEXT         DEFAULT NULL,
    `create_time`    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `update_time`    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    `deleted`        TINYINT      NOT NULL DEFAULT 0,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_ai_document_public_id` (`public_id`),
    UNIQUE KEY `uk_ai_document_file` (`file_id`),
    KEY `idx_ai_document_user_status` (`user_id`, `status`, `update_time`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='Extracted AI document';

CREATE TABLE IF NOT EXISTS `ai_document_chunk` (
    `id`          BIGINT       NOT NULL COMMENT 'primary snowflake id',
    `document_id` BIGINT       NOT NULL COMMENT 'ai_document.id',
    `chunk_index` INT          NOT NULL,
    `content`     LONGTEXT     NOT NULL,
    `locator`     JSON         DEFAULT NULL COMMENT 'page/sheet/slide/paragraph/range metadata',
    `token_count` INT          NOT NULL DEFAULT 0,
    `embedding`   LONGBLOB     DEFAULT NULL COMMENT 'optional float vector encoding',
    `create_time` DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `update_time` DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_ai_document_chunk` (`document_id`, `chunk_index`),
    KEY `idx_ai_document_chunk_document` (`document_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='Searchable extracted document chunks';
