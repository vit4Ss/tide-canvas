package com.tidecanvas.model.vo;

import lombok.Data;
import java.time.LocalDateTime;

@Data
public class UserVO {
    private Long id;
    private String username;
    private String email;
    private String phone;
    private String nickname;
    private String avatar;
    private Integer role;
    private Integer status;
    private Integer apiQuota;
    private Integer points;
    private Integer isAuthor;
    private Long storageQuota;
    private LocalDateTime createTime;
    private LocalDateTime lastLoginTime;
}
