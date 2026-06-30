package com.tidecanvas.service.pay;

import lombok.Data;
import org.springframework.util.StringUtils;

import java.util.List;

/**
 * 易支付网关配置(来自 sys_config 表 pay.epay.* 配置项,可在管理后台维护)。
 *
 * @author tidecanvas
 */
@Data
public class EpayConfig {

    /** 是否启用在线支付 */
    private boolean enabled;

    /** 网关地址,如 https://api.ndow.cn */
    private String gateway;

    /** 商户ID */
    private String pid;

    /** 商户RSA私钥(Base64,兼容 PEM/PKCS#1) */
    private String merchantPrivateKey;

    /** 平台RSA公钥(Base64,用于回调与响应验签) */
    private String platformPublicKey;

    /** 异步通知地址(需公网可达) */
    private String notifyUrl;

    /** 支付完成后的页面跳转地址 */
    private String returnUrl;

    /** 启用的支付方式(alipay/wxpay 等) */
    private List<String> payTypes;

    /**
     * 发起支付所需的配置是否齐全
     */
    public boolean isComplete() {
        return StringUtils.hasText(gateway)
                && StringUtils.hasText(pid)
                && StringUtils.hasText(merchantPrivateKey)
                && StringUtils.hasText(platformPublicKey)
                && StringUtils.hasText(notifyUrl);
    }
}
