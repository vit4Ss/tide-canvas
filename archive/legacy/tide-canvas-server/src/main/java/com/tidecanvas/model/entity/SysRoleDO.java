package com.tidecanvas.model.entity;

import com.baomidou.mybatisplus.annotation.TableName;
import com.tidecanvas.common.BaseEntity;
import lombok.Data;
import lombok.EqualsAndHashCode;

/**
 * 管理角色（RBAC）。
 *
 * @author tidecanvas
 */
@Data
@EqualsAndHashCode(callSuper = true)
@TableName("sys_role")
public class SysRoleDO extends BaseEntity {

    private String name;

    private String code;

    /** 权限码，逗号分隔；* 表示全部 */
    private String permissions;

    /** 内置角色(不可删/改编码) */
    private Integer builtin;

    private String remark;
}
