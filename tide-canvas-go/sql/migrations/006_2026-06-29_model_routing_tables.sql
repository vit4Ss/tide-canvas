-- =============================================================
-- Migration 006 | 2026-06-29 | Production model routing
-- -------------------------------------------------------------
-- Splits user-facing logical models from physical upstream models,
-- stores route rules, provider health, and route decision logs.
-- =============================================================
USE tide_canvas;
SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS `ai_upstream_model` (
    `id`             BIGINT        NOT NULL COMMENT 'Snowflake primary key',
    `provider_id`    BIGINT        NOT NULL COMMENT 'ai_provider.id',
    `name`           VARCHAR(128)  NOT NULL COMMENT 'Operator display name',
    `model_id`       VARCHAR(128)  NOT NULL COMMENT 'Provider upstream model id',
    `type`           VARCHAR(16)   NOT NULL COMMENT 'image/video/text/audio',
    `capabilities`   JSON          DEFAULT NULL COMMENT 'Supported dimensions and capabilities',
    `config`         JSON          DEFAULT NULL COMMENT 'Provider/model specific passthrough config',
    `cost_per_call`  DECIMAL(10,4) NOT NULL DEFAULT 0.0000 COMMENT 'Upstream cost reference',
    `timeout_ms`     INT           NOT NULL DEFAULT 0 COMMENT 'Per-call timeout override; 0 uses provider/client default',
    `priority`       INT           NOT NULL DEFAULT 0 COMMENT 'Default upstream priority',
    `status`         TINYINT       NOT NULL DEFAULT 1 COMMENT '0 disabled, 1 enabled',
    `create_time`    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `update_time`    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    `deleted`        TINYINT       NOT NULL DEFAULT 0,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_provider_model` (`provider_id`, `model_id`, `deleted`),
    KEY `idx_provider_status` (`provider_id`, `status`),
    KEY `idx_type_status` (`type`, `status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='AI upstream provider model';

CREATE TABLE IF NOT EXISTS `ai_model_route` (
    `id`                BIGINT       NOT NULL COMMENT 'Snowflake primary key',
    `logical_model_id`  BIGINT       NOT NULL COMMENT 'ai_model.id shown to users',
    `upstream_model_id` BIGINT       NOT NULL COMMENT 'ai_upstream_model.id',
    `handler_name`      VARCHAR(64)  NOT NULL COMMENT 'text_to_image/image_to_video/etc',
    `route_strategy`    VARCHAR(16)  NOT NULL DEFAULT 'priority' COMMENT 'priority/weighted/fallback/latency',
    `complexity_level`  VARCHAR(16)  DEFAULT NULL COMMENT 'simple/standard/complex; NULL matches all',
    `conditions`        JSON         DEFAULT NULL COMMENT 'Future constraints: ratio/resolution/vip/region/etc',
    `priority`          INT          NOT NULL DEFAULT 0 COMMENT 'Higher wins for priority strategy',
    `weight`            INT          NOT NULL DEFAULT 100 COMMENT 'Weight for weighted strategy',
    `status`            TINYINT      NOT NULL DEFAULT 1 COMMENT '0 disabled, 1 enabled',
    `create_time`       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `update_time`       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    `deleted`           TINYINT      NOT NULL DEFAULT 0,
    PRIMARY KEY (`id`),
    KEY `idx_logical_handler_status` (`logical_model_id`, `handler_name`, `status`),
    KEY `idx_upstream_status` (`upstream_model_id`, `status`),
    KEY `idx_complexity` (`complexity_level`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='AI logical model route';

CREATE TABLE IF NOT EXISTS `ai_provider_health` (
    `id`                 BIGINT        NOT NULL COMMENT 'Snowflake primary key',
    `provider_id`        BIGINT        NOT NULL COMMENT 'ai_provider.id',
    `health_status`      VARCHAR(16)   NOT NULL DEFAULT 'unknown' COMMENT 'unknown/healthy/degraded/down',
    `failure_rate`       DECIMAL(6,4)  NOT NULL DEFAULT 0.0000 COMMENT 'Recent failure ratio',
    `avg_latency_ms`     INT           NOT NULL DEFAULT 0 COMMENT 'Recent average latency',
    `circuit_open_until` DATETIME      DEFAULT NULL COMMENT 'Skip provider until this time',
    `consecutive_errors` INT           NOT NULL DEFAULT 0 COMMENT 'Circuit breaker input',
    `last_error`         VARCHAR(512)  DEFAULT NULL COMMENT 'Last health error',
    `create_time`        DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `update_time`        DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    `deleted`            TINYINT       NOT NULL DEFAULT 0,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_provider` (`provider_id`, `deleted`),
    KEY `idx_status` (`health_status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='AI provider health state';

CREATE TABLE IF NOT EXISTS `ai_route_decision_log` (
    `id`                BIGINT       NOT NULL COMMENT 'Snowflake primary key',
    `task_id`           BIGINT       DEFAULT NULL COMMENT 'ai_task.id',
    `user_id`           BIGINT       DEFAULT NULL COMMENT 'sys_user.id',
    `logical_model_id`  BIGINT       DEFAULT NULL COMMENT 'ai_model.id',
    `upstream_model_id` BIGINT       DEFAULT NULL COMMENT 'ai_upstream_model.id',
    `provider_id`       BIGINT       DEFAULT NULL COMMENT 'ai_provider.id',
    `route_id`          BIGINT       DEFAULT NULL COMMENT 'ai_model_route.id',
    `handler_name`      VARCHAR(64)  NOT NULL COMMENT 'AI handler',
    `route_strategy`    VARCHAR(16)  DEFAULT NULL COMMENT 'Selected strategy',
    `logical_model`     VARCHAR(128) DEFAULT NULL COMMENT 'Logical model_id snapshot',
    `upstream_model`    VARCHAR(128) DEFAULT NULL COMMENT 'Upstream model_id snapshot',
    `complexity_level`  VARCHAR(16)  DEFAULT NULL COMMENT 'simple/standard/complex',
    `complexity_score`  INT          NOT NULL DEFAULT 0 COMMENT '0-100',
    `decision_reason`   VARCHAR(255) DEFAULT NULL COMMENT 'Why this route was selected',
    `candidate_count`   INT          NOT NULL DEFAULT 0 COMMENT 'Eligible candidate count',
    `fallback_used`     TINYINT      NOT NULL DEFAULT 0 COMMENT '1 when legacy/default fallback selected',
    `decision_metadata` JSON         DEFAULT NULL COMMENT 'Extra resolver metadata',
    `create_time`       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `update_time`       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    KEY `idx_task` (`task_id`),
    KEY `idx_user_time` (`user_id`, `create_time`),
    KEY `idx_logical_time` (`logical_model_id`, `create_time`),
    KEY `idx_upstream_time` (`upstream_model_id`, `create_time`),
    KEY `idx_handler_time` (`handler_name`, `create_time`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='AI route decision log';
