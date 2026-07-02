-- =============================================================
-- Migration 009 | 2026-07-02 | Style library presets
-- -------------------------------------------------------------
-- Adds admin-maintained/user-custom style presets, favorites and
-- recent usage records for the image generation style marketplace.
-- =============================================================
USE tide_canvas;
SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS `style_preset` (
    `id`             BIGINT       NOT NULL COMMENT 'Snowflake primary key',
    `public_id`      CHAR(36)     NOT NULL COMMENT 'Public UUID',
    `owner_user_id`  BIGINT       DEFAULT NULL COMMENT 'sys_user.id; NULL means system/admin preset',
    `name`           VARCHAR(64)  NOT NULL COMMENT 'Style display name',
    `short_name`     VARCHAR(24)  NOT NULL DEFAULT '' COMMENT 'Short label shown on canvas',
    `description`    VARCHAR(255) NOT NULL DEFAULT '' COMMENT 'Short style description',
    `prompt`         TEXT         NOT NULL COMMENT 'Prompt fragment appended during generation',
    `cover_url`      VARCHAR(512) NOT NULL DEFAULT '' COMMENT 'Cover image URL',
    `category`       VARCHAR(64)  NOT NULL DEFAULT '推荐' COMMENT 'Marketplace category',
    `author_name`    VARCHAR(64)  NOT NULL DEFAULT '' COMMENT 'Display author',
    `model_type`     VARCHAR(16)  NOT NULL DEFAULT 'image' COMMENT 'image/video/etc',
    `model_id`       VARCHAR(128) NOT NULL DEFAULT '' COMMENT 'Optional logical model id limit',
    `tags`           JSON         DEFAULT NULL COMMENT 'Search/display tags',
    `commercial`     TINYINT      NOT NULL DEFAULT 1 COMMENT '1 commercial use allowed',
    `public_flag`    TINYINT      NOT NULL DEFAULT 1 COMMENT '1 visible in style marketplace',
    `official`       TINYINT      NOT NULL DEFAULT 0 COMMENT '1 official/admin preset',
    `status`         TINYINT      NOT NULL DEFAULT 1 COMMENT '0 disabled, 1 enabled',
    `sort_order`     INT          NOT NULL DEFAULT 0 COMMENT 'Higher first',
    `usage_count`    BIGINT       NOT NULL DEFAULT 0 COMMENT 'Total selected count',
    `create_time`    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `update_time`    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    `deleted`        TINYINT      NOT NULL DEFAULT 0,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_public_id` (`public_id`),
    KEY `idx_marketplace` (`public_flag`, `status`, `category`, `sort_order`),
    KEY `idx_owner` (`owner_user_id`, `status`),
    KEY `idx_model` (`model_type`, `model_id`),
    KEY `idx_usage` (`usage_count`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='AI style preset library';

CREATE TABLE IF NOT EXISTS `style_favorite` (
    `id`          BIGINT   NOT NULL COMMENT 'Snowflake primary key',
    `user_id`     BIGINT   NOT NULL COMMENT 'sys_user.id',
    `style_id`    BIGINT   NOT NULL COMMENT 'style_preset.id',
    `create_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `update_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_user_style` (`user_id`, `style_id`),
    KEY `idx_style` (`style_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='User favorite style presets';

CREATE TABLE IF NOT EXISTS `style_usage` (
    `id`          BIGINT   NOT NULL COMMENT 'Snowflake primary key',
    `user_id`     BIGINT   NOT NULL COMMENT 'sys_user.id',
    `style_id`    BIGINT   NOT NULL COMMENT 'style_preset.id',
    `use_count`   INT      NOT NULL DEFAULT 1 COMMENT 'User selected count',
    `create_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `update_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_user_style` (`user_id`, `style_id`),
    KEY `idx_user_recent` (`user_id`, `update_time`),
    KEY `idx_style` (`style_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='User recent style usage';

INSERT IGNORE INTO `style_preset`
(`id`, `public_id`, `name`, `short_name`, `description`, `prompt`, `category`, `author_name`, `model_type`, `tags`, `commercial`, `public_flag`, `official`, `status`, `sort_order`, `deleted`)
VALUES
(910001, '00000000-0000-4000-8000-000000000101', '电影质感', '电影', '低饱和电影光影、真实镜头语言、细腻景深和高级调色', 'cinematic lighting, subtle film grain, realistic camera language, shallow depth of field, premium color grading', '推荐', 'TideCanvas', 'image', JSON_ARRAY('cinematic','photo'), 1, 1, 1, 1, 980, 0),
(910002, '00000000-0000-4000-8000-000000000102', '电商详情页', '电商', '适合商品主图、详情页海报和卖点展示，画面干净有销售感', 'clean commercial product poster, e-commerce detail page layout, premium product lighting, clear selling points, studio quality', '电商营销', 'TideCanvas', 'image', JSON_ARRAY('product','ecommerce'), 1, 1, 1, 1, 960, 0),
(910003, '00000000-0000-4000-8000-000000000103', 'CCD 复古', 'CCD', '复古数码相机颗粒、闪光灯、轻微过曝和真实生活抓拍感', 'retro CCD camera look, direct flash, slight overexposure, authentic snapshot feeling, nostalgic color cast', '摄影写真', 'TideCanvas', 'image', JSON_ARRAY('photo','retro'), 1, 1, 1, 1, 940, 0),
(910004, '00000000-0000-4000-8000-000000000104', '二次元清新', '二次元', '清透动漫插画风，色彩柔和、人物精致、背景轻盈', 'fresh anime illustration, soft pastel colors, delicate character design, clean background, polished line art', '动漫游戏', 'TideCanvas', 'image', JSON_ARRAY('anime','illustration'), 1, 1, 1, 1, 920, 0),
(910005, '00000000-0000-4000-8000-000000000105', '建筑室内写实', '室内', '建筑与室内空间写实渲染，真实材质、自然采光和高级空间构图', 'photorealistic architecture and interior rendering, natural daylight, realistic materials, refined spatial composition', '建筑及室内设计', 'TideCanvas', 'image', JSON_ARRAY('architecture','interior'), 1, 1, 1, 1, 900, 0),
(910006, '00000000-0000-4000-8000-000000000106', '平面设计海报', '海报', '强版式设计、明确层级、适合品牌视觉和营销活动海报', 'graphic design poster, strong typography hierarchy, clean visual layout, brand campaign style, high-end editorial composition', '平面设计', 'TideCanvas', 'image', JSON_ARRAY('poster','design'), 1, 1, 1, 1, 880, 0);
