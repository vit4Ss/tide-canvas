package com.tidecanvas.model.entity;

import com.baomidou.mybatisplus.annotation.TableName;
import com.tidecanvas.common.BaseEntity;
import lombok.Data;
import lombok.EqualsAndHashCode;
import java.time.LocalDateTime;

@Data
@EqualsAndHashCode(callSuper = true)
@TableName("sys_user")
public class SysUserDO extends BaseEntity {
    private String username;
    private String email;
    private String phone;
    private String password;
    private String nickname;
    private String avatar;
    private Integer role;
    private Integer status;
    private Integer apiQuota;
    private Integer points;
    private Integer isAuthor;
    private Long storageQuota;
    private LocalDateTime lastLoginTime;
}
