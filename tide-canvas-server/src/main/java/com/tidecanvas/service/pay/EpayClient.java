package com.tidecanvas.service.pay;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.tidecanvas.common.ResultCode;
import com.tidecanvas.exception.BusinessException;
import com.tidecanvas.util.EpaySignUtil;
import jakarta.annotation.PostConstruct;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.MediaType;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.stereotype.Component;
import org.springframework.util.LinkedMultiValueMap;
import org.springframework.util.MultiValueMap;
import org.springframework.util.StringUtils;
import org.springframework.web.client.RestClient;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * 易支付 V2 网关客户端:构建页面跳转支付参数、订单查询。
 * <p>
 * 协议:application/x-www-form-urlencoded 提交,JSON 返回,SHA256WithRSA 签名;
 * 响应若携带 sign 则必须用平台公钥验签通过,防止伪造查单结果导致错误上分。
 *
 * @author tidecanvas
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class EpayClient {

    private static final String SUBMIT_PATH = "/api/pay/submit";
    private static final String QUERY_PATH = "/api/pay/query";
    private static final String SIGN_TYPE_RSA = "RSA";

    private final ObjectMapper objectMapper;

    private RestClient http;

    @PostConstruct
    void init() {
        SimpleClientHttpRequestFactory factory = new SimpleClientHttpRequestFactory();
        factory.setConnectTimeout(10_000);
        factory.setReadTimeout(15_000);
        http = RestClient.builder().requestFactory(factory).build();
    }

    /**
     * 页面跳转支付的提交地址(前端以 form POST 方式跳转)
     */
    public String submitUrl(EpayConfig config) {
        return trimTrailingSlash(config.getGateway()) + SUBMIT_PATH;
    }

    /**
     * 构建页面跳转支付参数(含签名)。payType 为空时不传 type,由网关收银台让用户选择。
     */
    public Map<String, String> buildSubmitParams(EpayConfig config, String outTradeNo,
                                                 BigDecimal amount, String productName, String payType) {
        Map<String, String> params = new LinkedHashMap<>();
        params.put("pid", config.getPid());
        if (StringUtils.hasText(payType)) {
            params.put("type", payType);
        }
        params.put("out_trade_no", outTradeNo);
        params.put("notify_url", config.getNotifyUrl());
        if (StringUtils.hasText(config.getReturnUrl())) {
            params.put("return_url", config.getReturnUrl());
        }
        params.put("name", productName);
        params.put("money", amount.setScale(2, RoundingMode.HALF_UP).toPlainString());
        params.put("timestamp", currentTimestamp());
        params.put("sign", EpaySignUtil.sign(EpaySignUtil.buildSignContent(params), config.getMerchantPrivateKey()));
        params.put("sign_type", SIGN_TYPE_RSA);
        return params;
    }

    /**
     * 订单查询。网关订单状态:0未支付 1已支付 2已退款 3已冻结 4预授权
     */
    public EpayOrderStatus queryOrder(EpayConfig config, String outTradeNo) {
        Map<String, String> params = new LinkedHashMap<>();
        params.put("pid", config.getPid());
        params.put("out_trade_no", outTradeNo);
        params.put("timestamp", currentTimestamp());
        params.put("sign", EpaySignUtil.sign(EpaySignUtil.buildSignContent(params), config.getMerchantPrivateKey()));
        params.put("sign_type", SIGN_TYPE_RSA);

        String body;
        try {
            MultiValueMap<String, String> form = new LinkedMultiValueMap<>();
            params.forEach(form::add);
            body = http.post()
                    .uri(trimTrailingSlash(config.getGateway()) + QUERY_PATH)
                    .contentType(MediaType.APPLICATION_FORM_URLENCODED)
                    .body(form)
                    .retrieve()
                    .body(String.class);
        } catch (Exception e) {
            log.error("Epay query request failed: outTradeNo={}, error={}", outTradeNo, e.getMessage());
            throw new BusinessException(ResultCode.PAYMENT_GATEWAY_ERROR);
        }

        try {
            JsonNode node = objectMapper.readTree(body);
            int code = node.path("code").asInt(-1);
            if (code != 0) {
                return new EpayOrderStatus(code, node.path("msg").asText(""), -1, null);
            }
            verifyResponseSign(node, config, outTradeNo);
            return new EpayOrderStatus(0, "", node.path("status").asInt(-1),
                    node.path("trade_no").asText(null));
        } catch (BusinessException e) {
            throw e;
        } catch (Exception e) {
            log.error("Epay query response parse failed: outTradeNo={}, body={}", outTradeNo, body);
            throw new BusinessException(ResultCode.PAYMENT_GATEWAY_ERROR);
        }
    }

    /**
     * 响应验签:取所有标量字段(剔除 sign/sign_type)拼接验签;无 sign 字段时仅告警(走 HTTPS 直连)。
     */
    private void verifyResponseSign(JsonNode node, EpayConfig config, String outTradeNo) {
        String sign = node.path("sign").asText("");
        if (!StringUtils.hasText(sign)) {
            log.warn("Epay query response has no sign, trust over TLS: outTradeNo={}", outTradeNo);
            return;
        }
        Map<String, String> respParams = new LinkedHashMap<>();
        node.fields().forEachRemaining(entry -> {
            // NullNode 也是 ValueNode,asText() 会变成字面量 "null" 污染签名串,须排除
            if (entry.getValue().isValueNode() && !entry.getValue().isNull()) {
                respParams.put(entry.getKey(), entry.getValue().asText());
            }
        });
        String content = EpaySignUtil.buildSignContent(respParams);
        if (!EpaySignUtil.verify(content, sign, config.getPlatformPublicKey())) {
            log.error("Epay query response sign verify failed: outTradeNo={}", outTradeNo);
            throw new BusinessException(ResultCode.PAYMENT_GATEWAY_ERROR);
        }
    }

    private String currentTimestamp() {
        return String.valueOf(System.currentTimeMillis() / 1000);
    }

    private String trimTrailingSlash(String url) {
        return url.endsWith("/") ? url.substring(0, url.length() - 1) : url;
    }

    /**
     * 查单结果:code=0 时 status 有效
     */
    public record EpayOrderStatus(int code, String msg, int status, String tradeNo) {

        /** 网关侧已支付 */
        public boolean isPaid() {
            return code == 0 && status == 1;
        }
    }
}
