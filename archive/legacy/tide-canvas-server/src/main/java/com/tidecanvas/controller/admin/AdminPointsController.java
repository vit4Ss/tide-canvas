package com.tidecanvas.controller.admin;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.tidecanvas.common.PageResult;
import com.tidecanvas.common.Result;
import com.tidecanvas.annotation.RequiresPermission;
import com.tidecanvas.common.ResultCode;
import com.tidecanvas.annotation.OperateLog;
import com.tidecanvas.enums.PointsTransactionTypeEnum;
import com.tidecanvas.exception.BusinessException;
import com.tidecanvas.mapper.AiTaskMapper;
import com.tidecanvas.mapper.PointsTransactionMapper;
import com.tidecanvas.model.dto.AdminPointsAdjustDTO;
import com.tidecanvas.model.dto.AdminTaskRefundDTO;
import com.tidecanvas.model.entity.AiTaskDO;
import com.tidecanvas.model.entity.PointsTransactionDO;
import com.tidecanvas.model.query.AdminPointsQuery;
import com.tidecanvas.model.query.PointsTransactionQuery;
import com.tidecanvas.model.vo.PointsTransactionVO;
import com.tidecanvas.service.PointsService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.beans.BeanUtils;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@Tag(name = "管理后台-积分管理")
@RestController
@RequestMapping("/api/admin/points")
@RequiredArgsConstructor
public class AdminPointsController {

    private final PointsService pointsService;
    private final AiTaskMapper taskMapper;
    private final PointsTransactionMapper transactionMapper;

    @Operation(summary = "积分交易记录列表")
    @RequiresPermission("points:view")
    @GetMapping("/transactions")
    public Result<PageResult<PointsTransactionVO>> listTransactions(AdminPointsQuery query) {
        PointsTransactionQuery transactionQuery = new PointsTransactionQuery();
        BeanUtils.copyProperties(query, transactionQuery);
        return Result.success(pointsService.listAllTransactions(transactionQuery));
    }

    @Operation(summary = "手动调整用户积分")
    @RequiresPermission("points:adjust")
    @OperateLog(action = "调整积分", target = "积分管理")
    @PostMapping("/adjust")
    public Result<Void> adjust(@Valid @RequestBody AdminPointsAdjustDTO dto) {
        if (dto.getAmount() == Integer.MIN_VALUE) {
            throw new BusinessException(ResultCode.BAD_REQUEST, "调整金额超出范围");
        }
        if (dto.getAmount() >= 0) {
            pointsService.addPoints(dto.getUserId(), dto.getAmount(),
                    PointsTransactionTypeEnum.ADMIN_ADJUST, null, dto.getRemark());
        } else {
            pointsService.deductPoints(dto.getUserId(), Math.abs(dto.getAmount()),
                    PointsTransactionTypeEnum.ADMIN_ADJUST, null, dto.getRemark());
        }
        return Result.success();
    }

    @Operation(summary = "对失败任务退还积分")
    @RequiresPermission("points:refund")
    @OperateLog(action = "退还积分", target = "积分管理")
    @PostMapping("/refund-task")
    @Transactional(rollbackFor = Exception.class)
    public Result<Integer> refundTask(@Valid @RequestBody AdminTaskRefundDTO dto) {
        AiTaskDO task = taskMapper.selectForUpdate(dto.getTaskId());
        if (task == null) {
            throw new BusinessException(ResultCode.NOT_FOUND, "任务不存在");
        }

        Long refunded = transactionMapper.selectCount(new LambdaQueryWrapper<PointsTransactionDO>()
                .eq(PointsTransactionDO::getBizId, dto.getTaskId())
                .eq(PointsTransactionDO::getType, PointsTransactionTypeEnum.AI_REFUND.getCode()));
        if (refunded != null && refunded > 0) {
            throw new BusinessException(ResultCode.BAD_REQUEST, "该任务已退过积分，请勿重复操作");
        }

        List<PointsTransactionDO> consumes = transactionMapper.selectList(new LambdaQueryWrapper<PointsTransactionDO>()
                .eq(PointsTransactionDO::getBizId, dto.getTaskId())
                .eq(PointsTransactionDO::getType, PointsTransactionTypeEnum.AI_CONSUME.getCode()));
        int refund = consumes.stream()
                .mapToInt(c -> c.getAmount() == null ? 0 : Math.abs(c.getAmount()))
                .sum();
        if (refund <= 0) {
            throw new BusinessException(ResultCode.BAD_REQUEST, "该任务无扣分记录，无需退款");
        }

        String reason = StringUtils.hasText(dto.getReason()) ? dto.getReason() : "无";
        pointsService.addPoints(task.getUserId(), refund, PointsTransactionTypeEnum.AI_REFUND,
                dto.getTaskId(), "管理员退款: " + reason);
        return Result.success(refund);
    }
}
