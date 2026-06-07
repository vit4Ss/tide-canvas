package com.tidecanvas.controller.admin;

import com.tidecanvas.common.Result;
import com.tidecanvas.model.dto.ManualBanDTO;
import com.tidecanvas.model.vo.BanInfoVO;
import com.tidecanvas.service.security.AbuseGuard;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

/**
 * 管理后台 - 反刷流 / 封禁管理。/api/admin/** 已要求 ADMIN 角色。
 *
 * @author tidecanvas
 */
@Tag(name = "管理后台-反刷流")
@RestController
@RequestMapping("/api/admin/security")
@RequiredArgsConstructor
public class AdminSecurityController {

    private final AbuseGuard abuseGuard;

    @Operation(summary = "当前活跃封禁列表")
    @GetMapping("/bans")
    public Result<List<BanInfoVO>> bans() {
        return Result.success(abuseGuard.listBans());
    }

    @Operation(summary = "手动封禁用户 / IP")
    @PostMapping("/ban")
    public Result<Void> ban(@Valid @RequestBody ManualBanDTO dto) {
        abuseGuard.manualBan(dto.getType(), dto.getValue(), dto.getSeconds(), dto.getReason());
        return Result.success();
    }

    @Operation(summary = "解封")
    @PostMapping("/unban")
    public Result<Void> unban(@RequestBody Map<String, String> body) {
        abuseGuard.unban(body.get("actor"));
        return Result.success();
    }
}
