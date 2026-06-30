package com.tidecanvas.model.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Data;

import java.io.Serializable;
import java.time.LocalDateTime;

/**
 * 登录日志（成功+失败都记录）
 *
 * @author tidecanvas
 */
@Data
@TableName("login_log")
public class LoginLogDO implements Serializable {
    @TableId(type = IdType.ASSIGN_ID)
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
