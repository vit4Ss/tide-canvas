package com.tidecanvas.controller.admin;

import com.tidecanvas.common.PageResult;
import com.tidecanvas.common.Result;
import com.tidecanvas.enums.PointsTransactionTypeEnum;
import com.tidecanvas.model.dto.AdminPointsAdjustDTO;
import com.tidecanvas.model.query.AdminPointsQuery;
import com.tidecanvas.model.query.PointsTransactionQuery;
import com.tidecanvas.model.vo.PointsTransactionVO;
import com.tidecanvas.service.PointsService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.beans.BeanUtils;
import org.springframework.web.bind.annotation.*;

/**
 * 管理后台 - 积分管理接口
 *
 * @author tidecanvas
 */
@Tag(name = "管理后台-积分管理")
@RestController
@RequestMapping("/api/admin/points")
@RequiredArgsConstructor
public class AdminPointsController {

    private final PointsService pointsService;

    @Operation(summary = "积分交易记录列表")
    @GetMapping("/transactions")
    public Result<PageResult<PointsTransactionVO>> listTransactions(AdminPointsQuery query) {
        PointsTransactionQuery transactionQuery = new PointsTransactionQuery();
        BeanUtils.copyProperties(query, transactionQuery);
        return Result.success(pointsService.listAllTransactions(transactionQuery));
    }

    @Operation(summary = "手动调整用户积分")
    @PostMapping("/adjust")
    public Result<Void> adjust(@Valid @RequestBody AdminPointsAdjustDTO dto) {
        if (dto.getAmount() >= 0) {
            pointsService.addPoints(dto.getUserId(), dto.getAmount(),
                    PointsTransactionTypeEnum.ADMIN_ADJUST, null, dto.getRemark());
        } else {
            pointsService.deductPoints(dto.getUserId(), Math.abs(dto.getAmount()),
                    PointsTransactionTypeEnum.ADMIN_ADJUST, null, dto.getRemark());
        }
        return Result.success();
    }
}
