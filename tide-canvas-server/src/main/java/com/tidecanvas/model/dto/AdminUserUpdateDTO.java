package com.tidecanvas.model.dto;

import lombok.Data;

@Data
public class AdminUserUpdateDTO {
    private Integer role;
    private Integer status;
    private Integer apiQuota;
    private Long storageQuota;
}
