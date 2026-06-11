package com.tidecanvas.util;

import java.nio.charset.StandardCharsets;
import java.security.KeyFactory;
import java.security.PrivateKey;
import java.security.PublicKey;
import java.security.Signature;
import java.security.spec.InvalidKeySpecException;
import java.security.spec.PKCS8EncodedKeySpec;
import java.security.spec.X509EncodedKeySpec;
import java.util.Base64;
import java.util.Map;
import java.util.stream.Collectors;

/**
 * 易支付 V2 协议(SHA256WithRSA)签名工具。
 * <p>
 * 签名规则:剔除 {@code sign}/{@code sign_type} 与空值参数,按参数名 ASCII 升序拼接为
 * {@code a=1&b=2}(值不做 URL 编码),用商户私钥做 SHA256withRSA 签名后 Base64;
 * 验签使用平台公钥。密钥兼容带/不带 PEM 头尾,私钥兼容 PKCS#8 与 PKCS#1,
 * 公钥兼容 X.509(SubjectPublicKeyInfo)与裸 RSAPublicKey。
 *
 * @author tidecanvas
 */
public final class EpaySignUtil {

    private static final String SIGN_ALGORITHM = "SHA256withRSA";
    /** AlgorithmIdentifier(rsaEncryption) 的 DER 编码,用于 PKCS#1 → PKCS#8/X.509 包装 */
    private static final byte[] RSA_ALG_ID = {
            0x30, 0x0d, 0x06, 0x09, 0x2a, (byte) 0x86, 0x48, (byte) 0x86,
            (byte) 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00
    };

    private EpaySignUtil() {
    }

    /**
     * 构建待签名字符串:剔除 sign/sign_type 与空值,ASCII 排序后以 & 连接
     */
    public static String buildSignContent(Map<String, String> params) {
        return params.entrySet().stream()
                .filter(e -> e.getKey() != null && !e.getKey().isEmpty())
                .filter(e -> e.getValue() != null && !e.getValue().isEmpty())
                .filter(e -> !"sign".equals(e.getKey()) && !"sign_type".equals(e.getKey()))
                .sorted(Map.Entry.comparingByKey())
                .map(e -> e.getKey() + "=" + e.getValue())
                .collect(Collectors.joining("&"));
    }

    /**
     * 商户私钥签名,返回 Base64 结果
     */
    public static String sign(String content, String merchantPrivateKey) {
        try {
            Signature signature = Signature.getInstance(SIGN_ALGORITHM);
            signature.initSign(parsePrivateKey(merchantPrivateKey));
            signature.update(content.getBytes(StandardCharsets.UTF_8));
            return Base64.getEncoder().encodeToString(signature.sign());
        } catch (Exception e) {
            throw new IllegalStateException("RSA签名失败,请检查商户私钥配置: " + e.getMessage(), e);
        }
    }

    /**
     * 平台公钥验签;参数异常或签名不符均返回 false
     */
    public static boolean verify(String content, String sign, String platformPublicKey) {
        if (content == null || sign == null || sign.isEmpty()) {
            return false;
        }
        try {
            Signature signature = Signature.getInstance(SIGN_ALGORITHM);
            signature.initVerify(parsePublicKey(platformPublicKey));
            signature.update(content.getBytes(StandardCharsets.UTF_8));
            return signature.verify(Base64.getDecoder().decode(sign));
        } catch (Exception e) {
            return false;
        }
    }

    private static PrivateKey parsePrivateKey(String raw) throws Exception {
        byte[] der = Base64.getDecoder().decode(stripPem(raw));
        KeyFactory factory = KeyFactory.getInstance("RSA");
        try {
            return factory.generatePrivate(new PKCS8EncodedKeySpec(der));
        } catch (InvalidKeySpecException e) {
            // PKCS#1(BEGIN RSA PRIVATE KEY)→ 包装为 PKCS#8 再解析
            byte[] pkcs8 = wrapDer((byte) 0x30, concat(
                    new byte[]{0x02, 0x01, 0x00}, RSA_ALG_ID, wrapDer((byte) 0x04, der)));
            return factory.generatePrivate(new PKCS8EncodedKeySpec(pkcs8));
        }
    }

    private static PublicKey parsePublicKey(String raw) throws Exception {
        byte[] der = Base64.getDecoder().decode(stripPem(raw));
        KeyFactory factory = KeyFactory.getInstance("RSA");
        try {
            return factory.generatePublic(new X509EncodedKeySpec(der));
        } catch (InvalidKeySpecException e) {
            // 裸 RSAPublicKey → 包装为 X.509 SubjectPublicKeyInfo 再解析
            byte[] x509 = wrapDer((byte) 0x30, concat(
                    RSA_ALG_ID, wrapDer((byte) 0x03, concat(new byte[]{0x00}, der))));
            return factory.generatePublic(new X509EncodedKeySpec(x509));
        }
    }

    /**
     * 去除 PEM 头尾与所有空白,得到纯 Base64
     */
    private static String stripPem(String raw) {
        if (raw == null) {
            throw new IllegalArgumentException("密钥为空");
        }
        return raw.replaceAll("-----[^-]+-----", "").replaceAll("\\s", "");
    }

    private static byte[] wrapDer(byte tag, byte[] content) {
        byte[] len;
        int n = content.length;
        if (n < 0x80) {
            len = new byte[]{(byte) n};
        } else if (n <= 0xFF) {
            len = new byte[]{(byte) 0x81, (byte) n};
        } else if (n <= 0xFFFF) {
            len = new byte[]{(byte) 0x82, (byte) (n >> 8), (byte) n};
        } else {
            len = new byte[]{(byte) 0x83, (byte) (n >> 16), (byte) (n >> 8), (byte) n};
        }
        byte[] out = new byte[1 + len.length + n];
        out[0] = tag;
        System.arraycopy(len, 0, out, 1, len.length);
        System.arraycopy(content, 0, out, 1 + len.length, n);
        return out;
    }

    private static byte[] concat(byte[]... parts) {
        int total = 0;
        for (byte[] part : parts) {
            total += part.length;
        }
        byte[] out = new byte[total];
        int pos = 0;
        for (byte[] part : parts) {
            System.arraycopy(part, 0, out, pos, part.length);
            pos += part.length;
        }
        return out;
    }
}
