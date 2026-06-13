package com.tidecanvas.model.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Data;

import java.io.Serializable;
import java.time.LocalDateTime;

/**
 * 访问日志（请求级明细，用于 PV/UV 统计）
 *
 * @author tidecanvas
 */
@Data
@TableName("access_log")
public class AccessLogDO implements Serializable {
    @TableId(type = IdType.ASSIGN_ID)
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
