-- 团队功能迁移（幂等）：在已运行的库上补建团队相关表 / 列 / 配置。
-- 用法：Get-Content sql\migration_team.sql | docker exec -i <mysql容器> mysql -uroot -p<密码> tide_canvas
USE `tide_canvas`;

CREATE TABLE IF NOT EXISTS `team` (
    `id`           BIGINT      NOT NULL COMMENT '主键',
    `name`         VARCHAR(64) NOT NULL COMMENT '团队名称',
    `owner_id`     BIGINT      NOT NULL COMMENT '团队管理员(创建者)用户ID',
    `invite_code`  VARCHAR(16) NOT NULL COMMENT '加入邀请码',
    `member_count` INT         NOT NULL DEFAULT 1 COMMENT '成员数(冗余,含管理员)',
    `create_time`  DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    `update_time`  DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    `deleted`      TINYINT     NOT NULL DEFAULT 0 COMMENT '逻辑删除',
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_invite_code` (`invite_code`),
    KEY `idx_owner_id` (`owner_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='团队表';

CREATE TABLE IF NOT EXISTS `team_member` (
    `id`          BIGINT   NOT NULL COMMENT '主键',
    `team_id`     BIGINT   NOT NULL COMMENT '团队ID',
    `user_id`     BIGINT   NOT NULL COMMENT '成员用户ID',
    `role`        TINYINT  NOT NULL DEFAULT 0 COMMENT '团队内角色(0:成员,1:管理员)',
    `create_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '加入时间',
    `update_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    `deleted`     TINYINT  NOT NULL DEFAULT 0 COMMENT '逻辑删除',
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_user_id` (`user_id`),
    KEY `idx_team_id` (`team_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='团队成员表';

-- sys_user.team_id：列不存在才添加
SET @col := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = 'tide_canvas' AND TABLE_NAME = 'sys_user' AND COLUMN_NAME = 'team_id');
SET @ddl := IF(@col = 0,
  'ALTER TABLE `sys_user` ADD COLUMN `team_id` BIGINT DEFAULT NULL COMMENT ''所属团队ID(冗余缓存)'' AFTER `storage_quota`',
  'SELECT 1');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;

-- 加价系数配置：不存在才插入（id 取较大常量避免与种子 1-11/雪花冲突）
INSERT INTO `sys_config` (`id`, `config_key`, `config_value`, `description`, `deleted`)
SELECT 5001, 'team.price.factor', '1.5', '团队模式AI消耗加价系数(>1)', 0
WHERE NOT EXISTS (SELECT 1 FROM `sys_config` WHERE `config_key` = 'team.price.factor');
