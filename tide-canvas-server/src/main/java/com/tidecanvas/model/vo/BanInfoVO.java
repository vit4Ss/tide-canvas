package com.tidecanvas.model.vo;

import lombok.Data;

/**
 * 活跃封禁信息 VO（反刷流后台）。
 *
 * @author tidecanvas
 */
@Data
public class BanInfoVO {

    /** 原始 actor key（u{userId} / ip{ip}），解封时回传 */
    private String actor;

    /** 维度类型：user / ip / other */
    private String type;

    /** 用户ID 或 IP */
    private String value;

    /** 封禁原因 */
    private String reason;

    /** 剩余封禁秒数 */
    private long expireSeconds;
}
