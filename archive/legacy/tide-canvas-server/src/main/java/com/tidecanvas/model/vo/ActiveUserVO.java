package com.tidecanvas.model.vo;

import lombok.Data;

import java.time.LocalDateTime;

/**
 * 活跃用户(最近登录)条目
 *
 * @author tidecanvas
 */
@Data
public class ActiveUserVO {
    private Long id;
    private String username;
    private String nickname;
    private String avatar;
    private Integer points;
    private LocalDateTime lastLoginTime;
}
