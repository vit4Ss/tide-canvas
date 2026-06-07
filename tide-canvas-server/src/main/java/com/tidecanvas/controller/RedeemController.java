package com.tidecanvas.controller;

import com.tidecanvas.common.Result;
import com.tidecanvas.model.dto.RedeemDTO;
import com.tidecanvas.model.vo.RedeemResultVO;
import com.tidecanvas.security.SecurityUtils;
import com.tidecanvas.service.RedeemService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.*;

@Tag(name = "兑换码")
@RestController
@RequestMapping("/api/redeem")
@RequiredArgsConstructor
public class RedeemController {

    private final RedeemService redeemService;

    @Operation(summary = "兑换兑换码")
    @PostMapping
    public Result<RedeemResultVO> redeem(@Valid @RequestBody RedeemDTO dto) {
        Long userId = SecurityUtils.getCurrentUserId();
        return Result.success(redeemService.redeem(userId, dto.getCode()));
    }
}
