package com.tidecanvas.model.vo;

import lombok.Data;

import java.time.LocalDateTime;

@Data
public class LoginLogVO {
    private Long id;
    private Long userId;
    private String username;
    /** 结果(1:成功,0:失败) */
    private Integer status;
    private String failReason;
    private String ip;
    private String userAgent;
    private LocalDateTime createTime;
}
