-- =============================================================
-- Migration 005 | 2026-06-29 | AI prompt preflight
-- -------------------------------------------------------------
-- Adds local prompt review policies and immutable preflight logs.
-- =============================================================
USE tide_canvas;
SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS `ai_prompt_policy` (
    `id`          BIGINT       NOT NULL COMMENT 'Snowflake primary key',
    `name`        VARCHAR(128) NOT NULL COMMENT 'Rule name',
    `category`    VARCHAR(64)  NOT NULL COMMENT 'Policy category',
    `match_type`  VARCHAR(16)  NOT NULL DEFAULT 'keyword' COMMENT 'keyword/regex',
    `pattern`     VARCHAR(512) NOT NULL COMMENT 'Keyword or regex pattern',
    `action`      VARCHAR(16)  NOT NULL DEFAULT 'block' COMMENT 'allow/review/block',
    `severity`    INT          NOT NULL DEFAULT 0 COMMENT 'Higher severity wins first',
    `description` VARCHAR(255) DEFAULT NULL COMMENT 'Operator notes',
    `status`      TINYINT      NOT NULL DEFAULT 1 COMMENT '0 disabled, 1 enabled',
    `create_time` DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `update_time` DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    `deleted`     TINYINT      NOT NULL DEFAULT 0,
    PRIMARY KEY (`id`),
    KEY `idx_status_severity` (`status`, `severity`),
    KEY `idx_category` (`category`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='AI prompt review policy';

CREATE TABLE IF NOT EXISTS `ai_prompt_review_log` (
    `id`                BIGINT       NOT NULL COMMENT 'Snowflake primary key',
    `user_id`           BIGINT       DEFAULT NULL COMMENT 'Request user',
    `handler_name`      VARCHAR(64)  NOT NULL COMMENT 'AI handler',
    `logical_model`     VARCHAR(128) DEFAULT NULL COMMENT 'User-selected logical model_id',
    `prompt`            TEXT         DEFAULT NULL COMMENT 'Truncated prompt snapshot',
    `action`            VARCHAR(16)  NOT NULL COMMENT 'allow/review/block',
    `category`          VARCHAR(64)  DEFAULT NULL COMMENT 'Matched category',
    `reason`            VARCHAR(255) DEFAULT NULL COMMENT 'Matched rule or reason',
    `matched_policy_id` BIGINT       DEFAULT NULL COMMENT 'Matched ai_prompt_policy.id',
    `complexity_level`  VARCHAR(16)  NOT NULL DEFAULT 'simple' COMMENT 'simple/standard/complex',
    `complexity_score`  INT          NOT NULL DEFAULT 0 COMMENT '0-100',
    `tags`              JSON         DEFAULT NULL COMMENT 'Complexity tags',
    `input_params`      JSON         DEFAULT NULL COMMENT 'Original generation input snapshot',
    `create_time`       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `update_time`       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    KEY `idx_user_time` (`user_id`, `create_time`),
    KEY `idx_action_time` (`action`, `create_time`),
    KEY `idx_handler_time` (`handler_name`, `create_time`),
    KEY `idx_complexity_time` (`complexity_level`, `create_time`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='AI prompt preflight review log';

INSERT INTO `ai_prompt_policy`
    (`id`, `name`, `category`, `match_type`, `pattern`, `action`, `severity`, `description`, `status`, `deleted`)
VALUES
    (202606290501, 'minor sexual content', 'sexual_minor', 'regex', '(?:child|minor|underage|kid).*(?:nude|sex|sexual|porn|explicit)|(?:nude|sex|sexual|porn|explicit).*(?:child|minor|underage|kid)', 'block', 100, 'Block sexualized minors', 1, 0),
    (202606290502, 'explicit child abuse material', 'sexual_minor', 'regex', '(?:csam|child sexual abuse|child porn|underage porn)', 'block', 100, 'Block explicit child sexual abuse material', 1, 0),
    (202606290503, 'weapon or explosive construction', 'weapon_instruction', 'regex', '(?:make|build|assemble|instructions?).*(?:bomb|explosive|detonator|improvised weapon)|(?:bomb|explosive|detonator).*(?:make|build|assemble)', 'block', 90, 'Block actionable explosive construction prompts', 1, 0),
    (202606290504, 'credential theft', 'cyber_abuse', 'regex', '(?:steal|phish|dump|exfiltrate).*(?:password|credential|token|cookie|account)|(?:password|credential|token|cookie).*(?:steal|phish|dump|exfiltrate)', 'block', 90, 'Block credential theft prompts', 1, 0),
    (202606290505, 'hard drug manufacturing', 'drug_instruction', 'regex', '(?:make|cook|synthesize|manufacture).*(?:meth|fentanyl|heroin|cocaine)|(?:meth|fentanyl|heroin|cocaine).*(?:recipe|synthesis|manufacture)', 'block', 90, 'Block hard drug manufacturing instructions', 1, 0)
ON DUPLICATE KEY UPDATE
    `name` = VALUES(`name`),
    `category` = VALUES(`category`),
    `match_type` = VALUES(`match_type`),
    `pattern` = VALUES(`pattern`),
    `action` = VALUES(`action`),
    `severity` = VALUES(`severity`),
    `description` = VALUES(`description`),
    `status` = VALUES(`status`),
    `deleted` = VALUES(`deleted`);
