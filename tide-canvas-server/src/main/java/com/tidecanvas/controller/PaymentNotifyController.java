package com.tidecanvas.controller;

import com.tidecanvas.service.PaymentService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestMethod;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

/**
 * 支付回调接口(免鉴权,路径已在 SecurityConfig 放行)。
 * <p>
 * 易支付以 GET 携带全部参数通知,验签通过且处理成功时应答纯文本 {@code success},
 * 其余应答会触发网关重试。
 *
 * @author tidecanvas
 */
@Tag(name = "支付回调")
@RestController
@RequestMapping("/api/orders/notify")
@RequiredArgsConstructor
public class PaymentNotifyController {

    private final PaymentService paymentService;

    @Operation(summary = "易支付异步通知")
    @RequestMapping(value = "/epay", method = {RequestMethod.GET, RequestMethod.POST},
            produces = MediaType.TEXT_PLAIN_VALUE)
    public String epayNotify(@RequestParam Map<String, String> params) {
        return paymentService.handleNotify(params);
    }
}
