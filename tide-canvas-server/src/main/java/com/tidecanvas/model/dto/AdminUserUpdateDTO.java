package com.tidecanvas.model.dto;

import lombok.Data;

@Data
public class AdminUserUpdateDTO {
    private Integer role;
    /** 管理角色ID(RBAC)；null 表示不分配(按超管放行) */
    private Long roleId;
    private Integer status;
    private Integer apiQuota;
    private Long storageQuota;
}
