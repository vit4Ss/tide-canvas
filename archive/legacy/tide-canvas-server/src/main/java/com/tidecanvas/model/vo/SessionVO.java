package com.tidecanvas.model.vo;

import lombok.Data;

import java.time.LocalDateTime;

/**
 * 最近在线会话（按 IP+用户 聚合访问日志，取最后活动时间）。
 *
 * @author tidecanvas
 */
@Data
public class SessionVO {
    private String username;
    private String ip;
    private String userAgent;
    private LocalDateTime lastActiveTime;
}
