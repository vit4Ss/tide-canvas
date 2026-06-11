package com.tidecanvas.util;

import org.junit.jupiter.api.Test;

import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * 易支付签名工具测试:拼接规则与 RSA 签名/验签自洽性
 */
class EpaySignUtilTest {

    @Test
    void buildSignContentSortsAndFilters() {
        Map<String, String> params = new LinkedHashMap<>();
        params.put("type", "alipay");
        params.put("pid", "1001");
        params.put("sign", "should-be-excluded");
        params.put("sign_type", "RSA");
        params.put("param", "");
        params.put("money", "1.00");
        params.put("out_trade_no", "TC123");

        String content = EpaySignUtil.buildSignContent(params);
        assertEquals("money=1.00&out_trade_no=TC123&pid=1001&type=alipay", content);
    }

    @Test
    void signAndVerifyRoundTrip() throws Exception {
        KeyPairGenerator generator = KeyPairGenerator.getInstance("RSA");
        generator.initialize(2048);
        KeyPair keyPair = generator.generateKeyPair();
        // PKCS#8 私钥 / X.509 公钥的纯 Base64(商户后台常见格式)
        String privateKey = Base64.getEncoder().encodeToString(keyPair.getPrivate().getEncoded());
        String publicKey = Base64.getEncoder().encodeToString(keyPair.getPublic().getEncoded());

        String content = "money=1.00&out_trade_no=TC123&pid=1001&trade_status=TRADE_SUCCESS";
        String sign = EpaySignUtil.sign(content, privateKey);

        assertTrue(EpaySignUtil.verify(content, sign, publicKey));
        assertFalse(EpaySignUtil.verify(content + "&money=9.99", sign, publicKey), "篡改内容须验签失败");
        assertFalse(EpaySignUtil.verify(content, sign.substring(1) + "A", publicKey), "篡改签名须验签失败");
    }

    @Test
    void acceptsPemWrappedKeys() throws Exception {
        KeyPairGenerator generator = KeyPairGenerator.getInstance("RSA");
        generator.initialize(2048);
        KeyPair keyPair = generator.generateKeyPair();
        String privatePem = "-----BEGIN PRIVATE KEY-----\n"
                + Base64.getMimeEncoder().encodeToString(keyPair.getPrivate().getEncoded())
                + "\n-----END PRIVATE KEY-----";
        String publicPem = "-----BEGIN PUBLIC KEY-----\n"
                + Base64.getMimeEncoder().encodeToString(keyPair.getPublic().getEncoded())
                + "\n-----END PUBLIC KEY-----";

        String content = "pid=1001&timestamp=1721206072";
        String sign = EpaySignUtil.sign(content, privatePem);
        assertTrue(EpaySignUtil.verify(content, sign, publicPem));
    }
}
