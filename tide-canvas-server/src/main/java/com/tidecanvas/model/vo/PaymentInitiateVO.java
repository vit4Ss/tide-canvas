package com.tidecanvas.model.vo;

import lombok.Data;

import java.util.Map;

/**
 * 发起支付VO:前端用 params 对 payUrl 做 form POST 跳转到网关收银台
 *
 * @author tidecanvas
 */
@Data
public class PaymentInitiateVO {

    /** 网关提交地址 */
    private String payUrl;

    /** 提交参数(含签名) */
    private Map<String, String> params;

    /** 订单号 */
    private String orderNo;
}
