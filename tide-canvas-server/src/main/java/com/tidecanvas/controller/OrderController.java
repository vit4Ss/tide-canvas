package com.tidecanvas.controller;

import com.tidecanvas.common.PageResult;
import com.tidecanvas.common.Result;
import com.tidecanvas.model.dto.RechargeCreateDTO;
import com.tidecanvas.model.query.OrderQuery;
import com.tidecanvas.model.vo.RechargeOrderVO;
import com.tidecanvas.security.SecurityUtils;
import com.tidecanvas.service.OrderService;
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

    @Operation(summary = "创建充值订单")
    @PostMapping("/recharge")
    public Result<RechargeOrderVO> createRechargeOrder(@Valid @RequestBody RechargeCreateDTO dto) {
        Long userId = SecurityUtils.getCurrentUserId();
        return Result.success(orderService.createOrder(userId, dto));
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
