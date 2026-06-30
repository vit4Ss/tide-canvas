package com.tidecanvas.model.vo;

import lombok.Data;

import java.time.LocalDateTime;

@Data
public class AccessLogVO {
    private Long id;
    private Long userId;
    private String username;
    private String method;
    private String path;
    private String query;
    private Integer status;
    private Long durationMs;
    private String ip;
    private String userAgent;
    private LocalDateTime createTime;
}
