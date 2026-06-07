-- =============================================
-- TideCanvas 数据库初始化脚本
-- =============================================
SET NAMES utf8mb4;
SET CHARACTER_SET_CLIENT = utf8mb4;
SET CHARACTER_SET_RESULTS = utf8mb4;
SET CHARACTER_SET_CONNECTION = utf8mb4;

CREATE DATABASE IF NOT EXISTS `tide_canvas` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
USE `tide_canvas`;

-- ----------------------------
-- 用户表
-- ----------------------------
DROP TABLE IF EXISTS `sys_user`;
CREATE TABLE `sys_user` (
    `id`              BIGINT       NOT NULL COMMENT '主键',
    `username`        VARCHAR(64)  NOT NULL COMMENT '用户名',
    `email`           VARCHAR(128) NOT NULL COMMENT '邮箱',
    `phone`           VARCHAR(20)  DEFAULT NULL COMMENT '手机号',
    `password`        VARCHAR(255) NOT NULL COMMENT '加密密码',
    `nickname`        VARCHAR(64)  DEFAULT NULL COMMENT '昵称',
    `avatar`          VARCHAR(512) DEFAULT NULL COMMENT '头像URL',
    `role`            TINYINT      NOT NULL DEFAULT 0 COMMENT '角色(0:普通用户,1:VIP,9:管理员)',
    `status`          TINYINT      NOT NULL DEFAULT 1 COMMENT '状态(0:禁用,1:正常)',
    `api_quota`       INT          NOT NULL DEFAULT 100 COMMENT 'AI API调用额度(已废弃)',
    `points`          INT          NOT NULL DEFAULT 0 COMMENT '积分余额',
    `is_author`       TINYINT      NOT NULL DEFAULT 0 COMMENT '是否签约作者(0:否,1:是)',
    `storage_quota`   BIGINT       NOT NULL DEFAULT 1073741824 COMMENT '存储额度(bytes)',
    `last_login_time` DATETIME     DEFAULT NULL COMMENT '最后登录时间',
    `create_time`     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    `update_time`     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    `deleted`         TINYINT      NOT NULL DEFAULT 0 COMMENT '逻辑删除(0:未删除,1:已删除)',
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_username` (`username`),
    UNIQUE KEY `uk_email` (`email`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='用户表';

-- ----------------------------
-- 画布项目表
-- ----------------------------
DROP TABLE IF EXISTS `canvas_project`;
CREATE TABLE `canvas_project` (
    `id`          BIGINT       NOT NULL COMMENT '主键',
    `user_id`     BIGINT       NOT NULL COMMENT '所属用户',
    `name`        VARCHAR(128) NOT NULL COMMENT '项目名称',
    `description` TEXT         DEFAULT NULL COMMENT '项目描述',
    `thumbnail`   VARCHAR(512) DEFAULT NULL COMMENT '缩略图URL',
    `canvas_data` LONGTEXT     DEFAULT NULL COMMENT '画布JSON数据',
    `is_public`   TINYINT      NOT NULL DEFAULT 0 COMMENT '是否公开(0:否,1:是)',
    `share_token` VARCHAR(64)  DEFAULT NULL COMMENT '分享Token(/share/{token})',
    `url_token`   VARCHAR(32)  DEFAULT NULL COMMENT '画布编辑URL不透明短Token(/canvas/{urlToken})',
    `status`      TINYINT      NOT NULL DEFAULT 0 COMMENT '状态(0:草稿,1:已发布)',
    `create_time` DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    `update_time` DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    `deleted`     TINYINT      NOT NULL DEFAULT 0 COMMENT '逻辑删除',
    PRIMARY KEY (`id`),
    KEY `idx_user_id` (`user_id`),
    KEY `idx_share_token` (`share_token`),
    UNIQUE KEY `uk_url_token` (`url_token`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='画布项目表';

-- ----------------------------
-- AI供应商表
-- ----------------------------
DROP TABLE IF EXISTS `ai_provider`;
CREATE TABLE `ai_provider` (
    `id`            BIGINT       NOT NULL COMMENT '主键',
    `name`          VARCHAR(64)  NOT NULL COMMENT '供应商名称',
    `provider_type` VARCHAR(32)  NOT NULL COMMENT '类型(openai/gemini/doubao等)',
    `api_key`       VARCHAR(512) NOT NULL COMMENT '加密的API Key',
    `backup_keys`   TEXT         DEFAULT NULL COMMENT '备用Key(JSON数组)',
    `base_url`      VARCHAR(255) NOT NULL COMMENT 'API地址',
    `status`        TINYINT      NOT NULL DEFAULT 1 COMMENT '状态(0:禁用,1:启用)',
    `priority`      INT          NOT NULL DEFAULT 0 COMMENT '优先级',
    `rate_limit`    INT          NOT NULL DEFAULT 60 COMMENT '每分钟请求上限',
    `config`        JSON         DEFAULT NULL COMMENT '供应商特定配置',
    `create_time`   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    `update_time`   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    `deleted`       TINYINT      NOT NULL DEFAULT 0 COMMENT '逻辑删除',
    PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='AI供应商表';

-- ----------------------------
-- AI模型表
-- ----------------------------
DROP TABLE IF EXISTS `ai_model`;
CREATE TABLE `ai_model` (
    `id`                 BIGINT        NOT NULL COMMENT '主键',
    `provider_id`        BIGINT        NOT NULL COMMENT '供应商ID',
    `name`               VARCHAR(64)   NOT NULL COMMENT '显示名称',
    `icon`               VARCHAR(255)  DEFAULT NULL COMMENT '模型图标(emoji或图片URL)',
    `model_id`           VARCHAR(128)  NOT NULL COMMENT '模型标识',
    `type`               VARCHAR(16)   NOT NULL COMMENT '类型(image/video/text)',
    `supported_handlers` JSON          DEFAULT NULL COMMENT '支持的handler列表',
    `config`             JSON          DEFAULT NULL COMMENT '模型参数配置',
    `cost_per_call`      DECIMAL(10,4) DEFAULT 0.0000 COMMENT '单次调用成本(货币)',
    `point_cost`         INT           NOT NULL DEFAULT 10 COMMENT '每次调用消耗积分',
    `status`             TINYINT       NOT NULL DEFAULT 1 COMMENT '状态',
    `create_time`        DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    `update_time`        DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    `deleted`            TINYINT       NOT NULL DEFAULT 0 COMMENT '逻辑删除',
    PRIMARY KEY (`id`),
    KEY `idx_provider_id` (`provider_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='AI模型表';

-- ----------------------------
-- AI Handler配置表
-- ----------------------------
DROP TABLE IF EXISTS `ai_handler_config`;
CREATE TABLE `ai_handler_config` (
    `id`               BIGINT       NOT NULL COMMENT '主键',
    `handler_name`     VARCHAR(64)  NOT NULL COMMENT 'handler标识',
    `display_name`     VARCHAR(64)  NOT NULL COMMENT '显示名称',
    `description`      VARCHAR(255) DEFAULT NULL COMMENT '描述',
    `input_schema`     JSON         DEFAULT NULL COMMENT '输入参数JSON Schema',
    `default_model_id` BIGINT       DEFAULT NULL COMMENT '默认模型ID',
    `async_flag`       TINYINT      NOT NULL DEFAULT 1 COMMENT '是否异步(0:否,1:是)',
    `status`           TINYINT      NOT NULL DEFAULT 1 COMMENT '状态(0:禁用,1:启用)',
    `sort_order`       INT          NOT NULL DEFAULT 0 COMMENT '排序',
    `point_cost`       INT          NOT NULL DEFAULT 18 COMMENT '每次调用消耗积分',
    `create_time`      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    `update_time`      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    `deleted`          TINYINT      NOT NULL DEFAULT 0 COMMENT '逻辑删除',
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_handler_name` (`handler_name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='AI Handler配置表';

-- ----------------------------
-- AI任务表
-- ----------------------------
DROP TABLE IF EXISTS `ai_task`;
CREATE TABLE `ai_task` (
    `id`            BIGINT        NOT NULL COMMENT '主键',
    `user_id`       BIGINT        NOT NULL COMMENT '用户ID',
    `project_id`    BIGINT        DEFAULT NULL COMMENT '项目ID',
    `handler_name`  VARCHAR(64)   NOT NULL COMMENT '使用的handler',
    `model_id`      BIGINT        DEFAULT NULL COMMENT '使用的模型',
    `input_params`  JSON          DEFAULT NULL COMMENT '请求输入快照',
    `result_url`    VARCHAR(512)  DEFAULT NULL COMMENT '结果文件URL',
    `result_meta`   JSON          DEFAULT NULL COMMENT '结果元数据',
    `status`        TINYINT       NOT NULL DEFAULT 0 COMMENT '状态(0:处理中,1:成功,2:失败,3:已取消)',
    `progress`      TINYINT       NOT NULL DEFAULT 0 COMMENT '进度(0-100)',
    `error_msg`     TEXT          DEFAULT NULL COMMENT '错误信息',
    `cost`          DECIMAL(10,4) DEFAULT 0.0000 COMMENT '调用成本',
    `complete_time` DATETIME      DEFAULT NULL COMMENT '完成时间',
    `create_time`   DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    `update_time`   DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    `deleted`       TINYINT       NOT NULL DEFAULT 0 COMMENT '逻辑删除',
    PRIMARY KEY (`id`),
    KEY `idx_user_id` (`user_id`),
    KEY `idx_project_id` (`project_id`),
    KEY `idx_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='AI任务表';

-- ----------------------------
-- AI生成日志表（每次上游中转站调用的请求/响应/成败，便于排查生成失败）
-- ----------------------------
DROP TABLE IF EXISTS `ai_generation_log`;
CREATE TABLE `ai_generation_log` (
    `id`               BIGINT        NOT NULL COMMENT '主键',
    `task_id`          BIGINT        DEFAULT NULL COMMENT '关联AI任务ID',
    `user_id`          BIGINT        DEFAULT NULL COMMENT '用户ID',
    `project_id`       BIGINT        DEFAULT NULL COMMENT '画布项目ID',
    `handler_name`     VARCHAR(64)   DEFAULT NULL COMMENT 'handler',
    `operation_type`   VARCHAR(32)   NOT NULL DEFAULT 'ai_generate' COMMENT '操作大类(ai_generate/file_upload/file_delete/asset_save)',
    `model`            VARCHAR(128)  DEFAULT NULL COMMENT '上游模型',
    `operation`        VARCHAR(32)   DEFAULT NULL COMMENT '操作(generation/edits/video)',
    `request_url`      VARCHAR(512)  DEFAULT NULL COMMENT '上游请求地址',
    `request_body`     TEXT          DEFAULT NULL COMMENT '上游请求体',
    `http_status`      INT           DEFAULT NULL COMMENT '上游HTTP状态码',
    `response_body`    TEXT          DEFAULT NULL COMMENT '上游响应体(截断)',
    `upstream_task_id` VARCHAR(128)  DEFAULT NULL COMMENT '上游任务ID',
    `success`          TINYINT       NOT NULL DEFAULT 0 COMMENT '是否成功(0失败,1成功)',
    `result_url`       VARCHAR(1024) DEFAULT NULL COMMENT '结果地址',
    `error_msg`        TEXT          DEFAULT NULL COMMENT '错误信息',
    `duration_ms`      BIGINT        DEFAULT NULL COMMENT '耗时(ms)',
    `create_time`      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    PRIMARY KEY (`id`),
    KEY `idx_task_id` (`task_id`),
    KEY `idx_user_id` (`user_id`),
    KEY `idx_project_id` (`project_id`),
    KEY `idx_operation_type` (`operation_type`),
    KEY `idx_create_time` (`create_time`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='操作日志表(AI生成/文件上传等)';

-- ----------------------------
-- 兑换码表
-- ----------------------------
DROP TABLE IF EXISTS `redeem_code`;
CREATE TABLE `redeem_code` (
    `id`          BIGINT       NOT NULL COMMENT '主键',
    `code`        VARCHAR(32)  NOT NULL COMMENT '兑换码',
    `points`      INT          NOT NULL DEFAULT 0 COMMENT '兑换积分',
    `status`      TINYINT      NOT NULL DEFAULT 0 COMMENT '状态(0未使用,1已使用,2已停用)',
    `used_by`     BIGINT       DEFAULT NULL COMMENT '使用者用户ID',
    `used_time`   DATETIME     DEFAULT NULL COMMENT '使用时间',
    `expire_time` DATETIME     DEFAULT NULL COMMENT '有效期(空=永久)',
    `batch_no`    VARCHAR(32)  DEFAULT NULL COMMENT '批次号',
    `remark`      VARCHAR(255) DEFAULT NULL COMMENT '备注',
    `create_time` DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    `update_time` DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    `deleted`     TINYINT      NOT NULL DEFAULT 0 COMMENT '逻辑删除',
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_code` (`code`),
    KEY `idx_status` (`status`),
    KEY `idx_used_by` (`used_by`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='兑换码表';

-- ----------------------------
-- 文件表
-- ----------------------------
DROP TABLE IF EXISTS `sys_file`;
CREATE TABLE `sys_file` (
    `id`            BIGINT       NOT NULL COMMENT '主键',
    `user_id`       BIGINT       NOT NULL COMMENT '上传者',
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
    KEY `idx_user_id` (`user_id`),
    KEY `idx_hash` (`hash`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='文件表';

-- ----------------------------
-- Banner表
-- ----------------------------
DROP TABLE IF EXISTS `sys_banner`;
CREATE TABLE `sys_banner` (
    `id`          BIGINT       NOT NULL COMMENT '主键',
    `title`       VARCHAR(128) NOT NULL COMMENT '标题',
    `image_url`   VARCHAR(512) NOT NULL COMMENT '图片URL',
    `link_url`    VARCHAR(512) DEFAULT NULL COMMENT '跳转链接',
    `sort_order`  INT          NOT NULL DEFAULT 0 COMMENT '排序',
    `status`      TINYINT      NOT NULL DEFAULT 1 COMMENT '状态(0:隐藏,1:显示)',
    `create_time` DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    `update_time` DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    `deleted`     TINYINT      NOT NULL DEFAULT 0 COMMENT '逻辑删除',
    PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='Banner表';

-- ----------------------------
-- 系统配置表
-- ----------------------------
DROP TABLE IF EXISTS `sys_config`;
CREATE TABLE `sys_config` (
    `id`           BIGINT       NOT NULL COMMENT '主键',
    `config_key`   VARCHAR(128) NOT NULL COMMENT '配置键',
    `config_value` TEXT         DEFAULT NULL COMMENT '配置值',
    `description`  VARCHAR(255) DEFAULT NULL COMMENT '描述',
    `create_time`  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    `update_time`  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    `deleted`      TINYINT      NOT NULL DEFAULT 0 COMMENT '逻辑删除',
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_config_key` (`config_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='系统配置表';

-- ----------------------------
-- 操作日志表
-- ----------------------------
DROP TABLE IF EXISTS `sys_log`;
CREATE TABLE `sys_log` (
    `id`          BIGINT       NOT NULL COMMENT '主键',
    `user_id`     BIGINT       DEFAULT NULL COMMENT '操作者',
    `username`    VARCHAR(64)  DEFAULT NULL COMMENT '操作者用户名',
    `action`      VARCHAR(64)  NOT NULL COMMENT '操作类型',
    `target`      VARCHAR(128) DEFAULT NULL COMMENT '操作目标',
    `detail`      TEXT         DEFAULT NULL COMMENT '详情',
    `ip`          VARCHAR(64)  DEFAULT NULL COMMENT 'IP地址',
    `create_time` DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '操作时间',
    PRIMARY KEY (`id`),
    KEY `idx_user_id` (`user_id`),
    KEY `idx_create_time` (`create_time`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='操作日志表';

-- ----------------------------
-- 积分流水表
-- ----------------------------
DROP TABLE IF EXISTS `points_transaction`;
CREATE TABLE `points_transaction` (
    `id`            BIGINT       NOT NULL COMMENT '主键',
    `user_id`       BIGINT       NOT NULL COMMENT '用户ID',
    `amount`        INT          NOT NULL COMMENT '变动数量(正=加/负=减)',
    `balance_after` INT          NOT NULL COMMENT '变动后余额',
    `type`          TINYINT      NOT NULL COMMENT '类型(1:充值,2:签到,3:AI消耗,4:查看博客,5:打赏支出,6:收到打赏,7:管理员调整)',
    `biz_id`        BIGINT       DEFAULT NULL COMMENT '关联业务ID',
    `remark`        VARCHAR(255) DEFAULT NULL COMMENT '备注',
    `create_time`   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    `update_time`   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    `deleted`       TINYINT      NOT NULL DEFAULT 0 COMMENT '逻辑删除',
    PRIMARY KEY (`id`),
    KEY `idx_user_id` (`user_id`),
    KEY `idx_type` (`type`),
    KEY `idx_create_time` (`create_time`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='积分流水表';

-- ----------------------------
-- 签到记录表
-- ----------------------------
DROP TABLE IF EXISTS `checkin_record`;
CREATE TABLE `checkin_record` (
    `id`              BIGINT   NOT NULL COMMENT '主键',
    `user_id`         BIGINT   NOT NULL COMMENT '用户ID',
    `checkin_date`    DATE     NOT NULL COMMENT '签到日期',
    `streak_days`     INT      NOT NULL DEFAULT 1 COMMENT '连续签到天数',
    `points_awarded`  INT      NOT NULL COMMENT '本次获得积分',
    `create_time`     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    `update_time`     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    `deleted`         TINYINT  NOT NULL DEFAULT 0 COMMENT '逻辑删除',
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_user_date` (`user_id`, `checkin_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='签到记录表';

-- ----------------------------
-- 社区帖子表
-- ----------------------------
DROP TABLE IF EXISTS `community_post`;
CREATE TABLE `community_post` (
    `id`            BIGINT       NOT NULL COMMENT '主键',
    `user_id`       BIGINT       NOT NULL COMMENT '发布者ID',
    `title`         VARCHAR(200) NOT NULL COMMENT '标题',
    `content`       LONGTEXT     NOT NULL COMMENT '内容(富文本)',
    `images`        JSON         DEFAULT NULL COMMENT '图片URL数组',
    `category`      VARCHAR(32)  DEFAULT NULL COMMENT '分类',
    `tags`          JSON         DEFAULT NULL COMMENT '标签数组',
    `view_count`    INT          NOT NULL DEFAULT 0 COMMENT '浏览量',
    `like_count`    INT          NOT NULL DEFAULT 0 COMMENT '点赞数',
    `comment_count` INT          NOT NULL DEFAULT 0 COMMENT '评论数',
    `status`        TINYINT      NOT NULL DEFAULT 1 COMMENT '状态(0:草稿,1:已发布,2:已下架)',
    `create_time`   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    `update_time`   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    `deleted`       TINYINT      NOT NULL DEFAULT 0 COMMENT '逻辑删除',
    PRIMARY KEY (`id`),
    KEY `idx_user_id` (`user_id`),
    KEY `idx_category` (`category`),
    KEY `idx_create_time` (`create_time`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='社区帖子表';

-- ----------------------------
-- 社区评论表
-- ----------------------------
DROP TABLE IF EXISTS `community_comment`;
CREATE TABLE `community_comment` (
    `id`          BIGINT   NOT NULL COMMENT '主键',
    `post_id`     BIGINT   NOT NULL COMMENT '帖子ID',
    `user_id`     BIGINT   NOT NULL COMMENT '评论者ID',
    `parent_id`   BIGINT   DEFAULT NULL COMMENT '父评论ID(null=顶级)',
    `content`     TEXT     NOT NULL COMMENT '评论内容',
    `like_count`  INT      NOT NULL DEFAULT 0 COMMENT '点赞数',
    `status`      TINYINT  NOT NULL DEFAULT 1 COMMENT '状态(0:隐藏,1:正常)',
    `create_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    `update_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    `deleted`     TINYINT  NOT NULL DEFAULT 0 COMMENT '逻辑删除',
    PRIMARY KEY (`id`),
    KEY `idx_post_id` (`post_id`),
    KEY `idx_user_id` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='社区评论表';

-- ----------------------------
-- 点赞记录表
-- ----------------------------
DROP TABLE IF EXISTS `community_like`;
CREATE TABLE `community_like` (
    `id`          BIGINT   NOT NULL COMMENT '主键',
    `user_id`     BIGINT   NOT NULL COMMENT '用户ID',
    `target_type` TINYINT  NOT NULL COMMENT '目标类型(1:帖子,2:评论,3:博客)',
    `target_id`   BIGINT   NOT NULL COMMENT '目标ID',
    `create_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_user_target` (`user_id`, `target_type`, `target_id`),
    KEY `idx_target` (`target_type`, `target_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='点赞记录表';

-- ----------------------------
-- 博客文章表
-- ----------------------------
DROP TABLE IF EXISTS `blog_post`;
CREATE TABLE `blog_post` (
    `id`               BIGINT       NOT NULL COMMENT '主键',
    `author_id`        BIGINT       NOT NULL COMMENT '作者ID',
    `title`            VARCHAR(200) NOT NULL COMMENT '标题',
    `content`          LONGTEXT     NOT NULL COMMENT '内容(富文本)',
    `summary`          VARCHAR(500) DEFAULT NULL COMMENT '摘要',
    `cover_image`      VARCHAR(512) DEFAULT NULL COMMENT '封面图URL',
    `category`         VARCHAR(32)  DEFAULT NULL COMMENT '分类',
    `tags`             JSON         DEFAULT NULL COMMENT '标签数组',
    `points_required`  INT          NOT NULL DEFAULT 0 COMMENT '阅读所需积分(0=免费)',
    `view_count`       INT          NOT NULL DEFAULT 0 COMMENT '浏览量',
    `like_count`       INT          NOT NULL DEFAULT 0 COMMENT '点赞数',
    `comment_count`    INT          NOT NULL DEFAULT 0 COMMENT '评论数',
    `tip_total`        INT          NOT NULL DEFAULT 0 COMMENT '累计打赏积分',
    `status`           TINYINT      NOT NULL DEFAULT 0 COMMENT '状态(0:草稿,1:已发布,2:已下架)',
    `create_time`      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    `update_time`      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    `deleted`          TINYINT      NOT NULL DEFAULT 0 COMMENT '逻辑删除',
    PRIMARY KEY (`id`),
    KEY `idx_author_id` (`author_id`),
    KEY `idx_category` (`category`),
    KEY `idx_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='博客文章表';

-- ----------------------------
-- 博客购买记录表
-- ----------------------------
DROP TABLE IF EXISTS `blog_purchase`;
CREATE TABLE `blog_purchase` (
    `id`          BIGINT   NOT NULL COMMENT '主键',
    `user_id`     BIGINT   NOT NULL COMMENT '购买者ID',
    `blog_id`     BIGINT   NOT NULL COMMENT '博客ID',
    `points_paid` INT      NOT NULL COMMENT '支付积分',
    `create_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_user_blog` (`user_id`, `blog_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='博客购买记录表';

-- ----------------------------
-- 充值订单表
-- ----------------------------
DROP TABLE IF EXISTS `recharge_order`;
CREATE TABLE `recharge_order` (
    `id`              BIGINT        NOT NULL COMMENT '主键',
    `order_no`        VARCHAR(64)   NOT NULL COMMENT '订单号',
    `user_id`         BIGINT        NOT NULL COMMENT '用户ID',
    `amount`          DECIMAL(10,2) NOT NULL COMMENT '支付金额(元)',
    `points_amount`   INT           NOT NULL COMMENT '充值积分数量',
    `payment_method`  VARCHAR(16)   DEFAULT NULL COMMENT '支付方式(alipay/wechat/manual)',
    `payment_no`      VARCHAR(128)  DEFAULT NULL COMMENT '第三方支付流水号',
    `status`          TINYINT       NOT NULL DEFAULT 0 COMMENT '状态(0:待支付,1:已支付,2:已取消,3:已退款)',
    `paid_time`       DATETIME      DEFAULT NULL COMMENT '支付时间',
    `create_time`     DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    `update_time`     DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    `deleted`         TINYINT       NOT NULL DEFAULT 0 COMMENT '逻辑删除',
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_order_no` (`order_no`),
    KEY `idx_user_id` (`user_id`),
    KEY `idx_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='充值订单表';

-- =============================================
-- 初始数据
-- =============================================

-- 管理员账号 (密码: admin123, points: 99999)
INSERT INTO `sys_user` (`id`, `username`, `email`, `password`, `nickname`, `role`, `status`, `api_quota`, `points`, `is_author`, `storage_quota`, `deleted`)
VALUES (1, 'admin', 'admin@tidecanvas.com', '$2a$10$xWkg68goWCoLr/wejRqqP.v516SEOQl20At/Zd/ReiBB2xeaT7zIy', '管理员', 9, 1, 99999, 99999, 1, 10737418240, 0);

-- 默认 Handler 配置
INSERT INTO `ai_handler_config` (`id`, `handler_name`, `display_name`, `description`, `async_flag`, `status`, `sort_order`, `deleted`) VALUES
(1, 'text_to_image',      '文生图',     '输入文字描述生成图片',          1, 1, 1,  0),
(2, 'image_to_image',     '图生图',     '以图片为参考生成新图片',        1, 1, 2,  0),
(3, 'text_to_video',      '文生视频',   '从文字描述生成视频',           1, 1, 3,  0),
(4, 'image_to_video',     '图生视频',   '从图片生成视频',              1, 1, 4,  0),
(5, 'start_end_to_video', '首尾帧视频', '从首尾帧生成过渡视频',         1, 1, 5,  0),
(12, 'reference_to_video', '参考生视频', '图片/视频/文字参考综合生成视频', 1, 1, 6,  0),
(6, 'creative_desc',      '创意描述',   'AI增强提示词',               0, 1, 6,  0),
(7, 'storyboard',         '分镜生成',   'AI编排多镜头故事板',           0, 1, 7,  0),
(8, 'panorama_360',       '全景图',     '生成360度全景图片',            1, 1, 8,  0),
(9, 'nine_grid',          '九宫格变体', '一键生成9种图片变体',           1, 1, 9,  0),
(10, 'split_grid_hd',     '分割高清',   '图片分割后独立放大',            1, 1, 10, 0),
(11, 'upscale',           '图片放大',   '图片超分辨率放大',             1, 1, 11, 0);

-- 默认系统配置
INSERT INTO `sys_config` (`id`, `config_key`, `config_value`, `description`, `deleted`) VALUES
(1,  'site.name',                'TideCanvas',       '站点名称',               0),
(2,  'site.description',         '无限画布AI创作平台', '站点描述',               0),
(3,  'register.enabled',         'true',             '是否开放注册',            0),
(4,  'default.api_quota',        '100',              '新用户默认API额度(已废弃)', 0),
(5,  'default.storage_quota',    '1073741824',       '新用户默认存储额度',       0),
(6,  'points.new_user',          '100',              '新用户赠送积分',           0),
(7,  'points.checkin.base',      '5',                '每日签到基础积分',         0),
(8,  'points.checkin.streak_bonus','2',              '连续签到每天额外积分',      0),
(9,  'points.checkin.streak_cap','20',               '连续签到额外积分上限',      0),
(10, 'points.recharge.ratio',    '10',               '充值比例(1元=N积分)',      0);
