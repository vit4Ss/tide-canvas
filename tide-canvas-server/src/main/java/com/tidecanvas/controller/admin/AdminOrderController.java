package com.tidecanvas.controller.admin;

import com.tidecanvas.common.PageResult;
import com.tidecanvas.common.Result;
import com.tidecanvas.model.query.AdminOrderQuery;
import com.tidecanvas.model.vo.RechargeOrderVO;
import com.tidecanvas.service.OrderService;
import com.tidecanvas.annotation.OperateLog;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.*;

/**
 * 管理后台 - 订单管理接口
 *
 * @author tidecanvas
 */
@Tag(name = "管理后台-订单管理")
@RestController
@RequestMapping("/api/admin/orders")
@RequiredArgsConstructor
public class AdminOrderController {

    private final OrderService orderService;

    @Operation(summary = "订单列表")
    @GetMapping
    public Result<PageResult<RechargeOrderVO>> list(AdminOrderQuery query) {
        return Result.success(orderService.listAllOrders(query));
    }

    @Operation(summary = "订单详情")
    @GetMapping("/{id}")
    public Result<RechargeOrderVO> get(@PathVariable Long id) {
        return Result.success(orderService.getOrderById(id));
    }

    @Operation(summary = "手动标记已支付")
    @OperateLog(action = "确认订单支付", target = "订单管理")
    @PostMapping("/{id}/pay")
    public Result<Void> markPaid(@PathVariable Long id) {
        orderService.payOrder(id);
        return Result.success();
    }
}
