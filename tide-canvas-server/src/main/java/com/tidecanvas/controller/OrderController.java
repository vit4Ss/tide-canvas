package com.tidecanvas.controller;

import com.tidecanvas.common.PageResult;
import com.tidecanvas.common.Result;
import com.tidecanvas.model.dto.PaymentInitiateDTO;
import com.tidecanvas.model.dto.RechargeCreateDTO;
import com.tidecanvas.model.query.OrderQuery;
import com.tidecanvas.model.vo.PaymentInitiateVO;
import com.tidecanvas.model.vo.RechargeConfigVO;
import com.tidecanvas.model.vo.RechargeOrderVO;
import com.tidecanvas.security.SecurityUtils;
import com.tidecanvas.service.OrderService;
import com.tidecanvas.service.PaymentService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.*;

/**
 * 订单接口
 *
 * @author tidecanvas
 */
@Tag(name = "订单管理")
@RestController
@RequestMapping("/api/orders")
@RequiredArgsConstructor
public class OrderController {

    private final OrderService orderService;
    private final PaymentService paymentService;

    @Operation(summary = "创建充值订单")
    @PostMapping("/recharge")
    public Result<RechargeOrderVO> createRechargeOrder(@Valid @RequestBody RechargeCreateDTO dto) {
        Long userId = SecurityUtils.getCurrentUserId();
        return Result.success(orderService.createOrder(userId, dto));
    }

    @Operation(summary = "充值配置（比例/支付方式/在线支付开关）")
    @GetMapping("/recharge-config")
    public Result<RechargeConfigVO> rechargeConfig() {
        return Result.success(paymentService.getRechargeConfig());
    }

    @Operation(summary = "发起在线支付")
    @PostMapping("/{id}/pay")
    public Result<PaymentInitiateVO> pay(@PathVariable Long id,
                                         @RequestBody(required = false) PaymentInitiateDTO dto) {
        Long userId = SecurityUtils.getCurrentUserId();
        String payType = dto != null ? dto.getPayType() : null;
        return Result.success(paymentService.initiatePay(userId, id, payType));
    }

    @Operation(summary = "主动同步支付状态（支付完成未收到回调时）")
    @PostMapping("/{id}/sync")
    public Result<RechargeOrderVO> sync(@PathVariable Long id) {
        Long userId = SecurityUtils.getCurrentUserId();
        return Result.success(paymentService.syncOrderStatus(userId, id));
    }

    @Operation(summary = "订单列表")
    @GetMapping
    public Result<PageResult<RechargeOrderVO>> list(OrderQuery query) {
        Long userId = SecurityUtils.getCurrentUserId();
        return Result.success(orderService.listOrders(userId, query));
    }

    @Operation(summary = "订单详情")
    @GetMapping("/{id}")
    public Result<RechargeOrderVO> get(@PathVariable Long id) {
        Long userId = SecurityUtils.getCurrentUserId();
        return Result.success(orderService.getUserOrder(userId, id));
    }

    @Operation(summary = "取消订单")
    @PostMapping("/{id}/cancel")
    public Result<Void> cancel(@PathVariable Long id) {
        Long userId = SecurityUtils.getCurrentUserId();
        orderService.cancelOrder(userId, id);
        return Result.success();
    }
}
