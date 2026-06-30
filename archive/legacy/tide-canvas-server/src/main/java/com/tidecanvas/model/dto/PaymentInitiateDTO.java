package com.tidecanvas.model.dto;

import lombok.Data;

/**
 * 发起支付DTO
 *
 * @author tidecanvas
 */
@Data
public class PaymentInitiateDTO {

    /** 支付方式(alipay/wxpay,可空,空则使用订单创建时的支付方式或网关收银台) */
    private String payType;
}
