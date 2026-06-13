-- ============================================================
-- 迁移脚本：新增「访问日志」与「登录日志」两张表
-- 用于已部署的生产库（CREATE TABLE IF NOT EXISTS，不影响存量数据）
-- 在生产 MySQL 执行一次即可
-- ============================================================

-- ----------------------------
-- 访问日志表（请求级明细，用于 PV/UV 统计，定期清理）
-- ----------------------------
CREATE TABLE IF NOT EXISTS `access_log` (
    `id`          BIGINT       NOT NULL COMMENT '主键',
    `user_id`     BIGINT       DEFAULT NULL COMMENT '用户ID(未登录为空)',
    `username`    VARCHAR(64)  DEFAULT NULL COMMENT '用户名',
    `method`      VARCHAR(10)  DEFAULT NULL COMMENT '请求方法',
    `path`        VARCHAR(255) NOT NULL COMMENT '请求路径',
    `query`       VARCHAR(512) DEFAULT NULL COMMENT '查询参数',
    `status`      INT          DEFAULT NULL COMMENT 'HTTP状态码',
    `duration_ms` BIGINT       DEFAULT NULL COMMENT '耗时(毫秒)',
    `ip`          VARCHAR(64)  DEFAULT NULL COMMENT 'IP地址',
    `user_agent`  VARCHAR(512) DEFAULT NULL COMMENT 'User-Agent',
    `create_time` DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '访问时间',
    PRIMARY KEY (`id`),
    KEY `idx_create_time` (`create_time`),
    KEY `idx_user_id` (`user_id`),
    KEY `idx_path` (`path`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='访问日志表';

-- ----------------------------
-- 登录日志表（成功+失败都记录）
-- ----------------------------
CREATE TABLE IF NOT EXISTS `login_log` (
    `id`          BIGINT       NOT NULL COMMENT '主键',
    `user_id`     BIGINT       DEFAULT NULL COMMENT '用户ID(账号不存在为空)',
    `username`    VARCHAR(64)  DEFAULT NULL COMMENT '登录账号(用户名/邮箱)',
    `status`      TINYINT      NOT NULL DEFAULT 1 COMMENT '结果(1:成功,0:失败)',
    `fail_reason` VARCHAR(128) DEFAULT NULL COMMENT '失败原因',
    `ip`          VARCHAR(64)  DEFAULT NULL COMMENT 'IP地址',
    `user_agent`  VARCHAR(512) DEFAULT NULL COMMENT 'User-Agent',
    `create_time` DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '登录时间',
    PRIMARY KEY (`id`),
    KEY `idx_create_time` (`create_time`),
    KEY `idx_user_id` (`user_id`),
    KEY `idx_username` (`username`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='登录日志表';
