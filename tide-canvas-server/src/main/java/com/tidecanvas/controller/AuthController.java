package com.tidecanvas.controller;

import com.tidecanvas.common.Result;
import com.tidecanvas.model.dto.RefreshTokenDTO;
import com.tidecanvas.model.dto.SendEmailCodeDTO;
import com.tidecanvas.model.dto.UpdatePasswordDTO;
import com.tidecanvas.model.dto.UserLoginDTO;
import com.tidecanvas.model.dto.UserRegisterDTO;
import com.tidecanvas.model.vo.LoginVO;
import com.tidecanvas.model.vo.UserVO;
import com.tidecanvas.annotation.RateLimit;
import com.tidecanvas.annotation.LimitDimension;
import com.tidecanvas.security.SecurityUtils;
import com.tidecanvas.service.AuthService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.*;

@Tag(name = "认证接口")
@RestController
@RequestMapping("/api/auth")
@RequiredArgsConstructor
public class AuthController {

    private final AuthService authService;

    @Operation(summary = "发送邮箱注册验证码")
    @RateLimit(name = "email_code", limit = 3, period = 60, dimension = LimitDimension.IP, banThreshold = 8, banSeconds = 600)
    @PostMapping("/email-code")
    public Result<Void> emailCode(@Valid @RequestBody SendEmailCodeDTO dto) {
        authService.sendEmailCode(dto.getEmail());
        return Result.success();
    }

    @Operation(summary = "用户注册")
    @RateLimit(name = "register", limit = 5, period = 60, dimension = LimitDimension.IP, banThreshold = 3, banSeconds = 1800)
    @PostMapping("/register")
    public Result<UserVO> register(@Valid @RequestBody UserRegisterDTO dto) {
        return Result.success(authService.register(dto));
    }

    @Operation(summary = "用户登录")
    @RateLimit(name = "login", limit = 10, period = 60, dimension = LimitDimension.IP, banThreshold = 5, banSeconds = 900)
    @PostMapping("/login")
    public Result<LoginVO> login(@Valid @RequestBody UserLoginDTO dto) {
        return Result.success(authService.login(dto));
    }

    @Operation(summary = "刷新Token")
    @PostMapping("/refresh")
    public Result<LoginVO> refresh(@Valid @RequestBody RefreshTokenDTO dto) {
        return Result.success(authService.refreshToken(dto));
    }

    @Operation(summary = "获取当前用户信息")
    @GetMapping("/me")
    public Result<UserVO> me() {
        Long userId = SecurityUtils.getCurrentUserId();
        return Result.success(authService.getCurrentUser(userId));
    }

    @Operation(summary = "修改密码")
    @PutMapping("/password")
    public Result<Void> updatePassword(@Valid @RequestBody UpdatePasswordDTO dto) {
        Long userId = SecurityUtils.getCurrentUserId();
        authService.updatePassword(userId, dto);
        return Result.success();
    }

    @Operation(summary = "退出登录")
    @PostMapping("/logout")
    public Result<Void> logout() {
        return Result.success();
    }
}
