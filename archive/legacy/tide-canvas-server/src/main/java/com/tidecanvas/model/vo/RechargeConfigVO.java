package com.tidecanvas.model.vo;

import lombok.Data;

import java.util.List;

/**
 * 充值配置VO(充值页展示用)
 *
 * @author tidecanvas
 */
@Data
public class RechargeConfigVO {

    /** 充值比例:1元 = N 积分 */
    private Integer ratio;

    /** 在线支付是否可用(开关开启且配置完整) */
    private Boolean onlinePayEnabled;

    /** 可用的支付方式(alipay/wxpay 等) */
    private List<String> payTypes;
}
