-- ============================================================
-- 迁移脚本：粒度权限管理（RBAC）
-- 新增 sys_role 角色表 + sys_user.role_id；种子超级管理员角色
-- 生产库执行一次即可
-- ============================================================

CREATE TABLE IF NOT EXISTS `sys_role` (
    `id`          BIGINT       NOT NULL COMMENT '主键',
    `name`        VARCHAR(64)  NOT NULL COMMENT '角色名',
    `code`        VARCHAR(64)  NOT NULL COMMENT '角色编码',
    `permissions` TEXT         DEFAULT NULL COMMENT '权限码,逗号分隔; * 表示全部',
    `builtin`     TINYINT      NOT NULL DEFAULT 0 COMMENT '内置角色(不可删/改编码)',
    `remark`      VARCHAR(255) DEFAULT NULL COMMENT '备注',
    `create_time` DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    `update_time` DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    `deleted`     TINYINT      NOT NULL DEFAULT 0 COMMENT '逻辑删除',
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_code` (`code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='管理角色表';

-- 管理员所属角色（RBAC 细粒度权限）；NULL 视为超级管理员，保证存量管理员不被锁死
ALTER TABLE `sys_user` ADD COLUMN `role_id` BIGINT DEFAULT NULL COMMENT '管理角色ID(RBAC)' AFTER `role`;

-- 内置超级管理员角色（全权，不可删）
INSERT INTO `sys_role` (`id`, `name`, `code`, `permissions`, `builtin`, `remark`)
VALUES (1, '超级管理员', 'super', '*', 1, '拥有全部权限，不可删除')
ON DUPLICATE KEY UPDATE `name` = `name`;
