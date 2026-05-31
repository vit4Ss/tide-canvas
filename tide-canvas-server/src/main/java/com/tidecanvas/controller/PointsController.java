package com.tidecanvas.controller;

import com.tidecanvas.common.PageResult;
import com.tidecanvas.common.Result;
import com.tidecanvas.model.query.PointsTransactionQuery;
import com.tidecanvas.model.vo.PointsBalanceVO;
import com.tidecanvas.model.vo.PointsTransactionVO;
import com.tidecanvas.security.SecurityUtils;
import com.tidecanvas.service.PointsService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 积分接口
 *
 * @author tidecanvas
 */
@Tag(name = "积分管理")
@RestController
@RequestMapping("/api/points")
@RequiredArgsConstructor
public class PointsController {

    private final PointsService pointsService;

    @Operation(summary = "查询积分余额")
    @GetMapping("/balance")
    public Result<PointsBalanceVO> balance() {
        Long userId = SecurityUtils.getCurrentUserId();
        return Result.success(pointsService.getBalance(userId));
    }

    @Operation(summary = "积分交易记录")
    @GetMapping("/transactions")
    public Result<PageResult<PointsTransactionVO>> transactions(PointsTransactionQuery query) {
        Long userId = SecurityUtils.getCurrentUserId();
        return Result.success(pointsService.listTransactions(userId, query));
    }
}
