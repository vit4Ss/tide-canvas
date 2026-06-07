package com.tidecanvas.controller.admin;

import com.tidecanvas.common.PageResult;
import com.tidecanvas.common.Result;
import com.tidecanvas.model.dto.GenerateRedeemDTO;
import com.tidecanvas.model.query.RedeemCodeQuery;
import com.tidecanvas.model.vo.RedeemCodeVO;
import com.tidecanvas.service.RedeemService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@Tag(name = "管理后台-兑换码")
@RestController
@RequestMapping("/api/admin/redeem")
@RequiredArgsConstructor
public class AdminRedeemController {

    private final RedeemService redeemService;

    @Operation(summary = "批量生成兑换码")
    @PostMapping("/generate")
    public Result<List<String>> generate(@Valid @RequestBody GenerateRedeemDTO dto) {
        return Result.success(redeemService.generate(dto));
    }

    @Operation(summary = "兑换码列表")
    @GetMapping
    public Result<PageResult<RedeemCodeVO>> list(RedeemCodeQuery query) {
        return Result.success(redeemService.list(query));
    }

    @Operation(summary = "启用/停用")
    @PutMapping("/{id}/status")
    public Result<Void> updateStatus(@PathVariable Long id, @RequestBody Map<String, Object> body) {
        redeemService.updateStatus(id, Integer.valueOf(String.valueOf(body.get("status"))));
        return Result.success();
    }

    @Operation(summary = "删除兑换码")
    @DeleteMapping("/{id}")
    public Result<Void> delete(@PathVariable Long id) {
        redeemService.delete(id);
        return Result.success();
    }
}
