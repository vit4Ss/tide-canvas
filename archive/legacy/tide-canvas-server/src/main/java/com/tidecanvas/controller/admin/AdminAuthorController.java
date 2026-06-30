package com.tidecanvas.controller.admin;

import com.tidecanvas.common.PageResult;
import com.tidecanvas.common.Result;
import com.tidecanvas.annotation.RequiresPermission;
import com.tidecanvas.model.query.AdminUserQuery;
import com.tidecanvas.model.vo.UserVO;
import com.tidecanvas.annotation.OperateLog;
import com.tidecanvas.service.AdminAuthorService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.*;

/**
 * 管理后台 - 作者管理接口
 *
 * @author tidecanvas
 */
@Tag(name = "管理后台-作者管理")
@RestController
@RequestMapping("/api/admin/authors")
@RequiredArgsConstructor
public class AdminAuthorController {

    private final AdminAuthorService adminAuthorService;

    @Operation(summary = "作者列表")
    @RequiresPermission("author:view")
    @GetMapping
    public Result<PageResult<UserVO>> list(AdminUserQuery query) {
        return Result.success(adminAuthorService.listAuthors(query));
    }

    @Operation(summary = "授予作者权限")
    @RequiresPermission("author:manage")
    @OperateLog(action = "授予作者", target = "作者管理")
    @PostMapping("/{userId}/grant")
    public Result<Void> grant(@PathVariable Long userId) {
        adminAuthorService.grantAuthor(userId);
        return Result.success();
    }

    @Operation(summary = "撤销作者权限")
    @RequiresPermission("author:manage")
    @OperateLog(action = "撤销作者", target = "作者管理")
    @PostMapping("/{userId}/revoke")
    public Result<Void> revoke(@PathVariable Long userId) {
        adminAuthorService.revokeAuthor(userId);
        return Result.success();
    }
}
