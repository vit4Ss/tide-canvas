package com.tidecanvas.controller.admin;

import com.tidecanvas.annotation.OperateLog;
import com.tidecanvas.annotation.RequiresPermission;
import com.tidecanvas.common.Result;
import com.tidecanvas.constant.AdminPermissions;
import com.tidecanvas.model.dto.RoleSaveDTO;
import com.tidecanvas.model.vo.RoleVO;
import com.tidecanvas.security.SecurityUserDetails;
import com.tidecanvas.security.SecurityUtils;
import com.tidecanvas.service.AdminRoleService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Set;

/**
 * 管理后台 - 角色与权限（RBAC）。
 *
 * @author tidecanvas
 */
@Tag(name = "管理后台-角色权限")
@RestController
@RequestMapping("/api/admin/roles")
@RequiredArgsConstructor
public class AdminRoleController {

    private final AdminRoleService roleService;

    @Operation(summary = "角色列表")
    @RequiresPermission("role:view")
    @GetMapping
    public Result<List<RoleVO>> list() {
        return Result.success(roleService.listRoles());
    }

    @Operation(summary = "权限目录")
    @RequiresPermission("role:view")
    @GetMapping("/catalog")
    public Result<List<AdminPermissions.Group>> catalog() {
        return Result.success(AdminPermissions.CATALOG);
    }

    @Operation(summary = "当前管理员的权限码（前端按此隐藏菜单/按钮，不鉴权）")
    @GetMapping("/my-permissions")
    public Result<Set<String>> myPermissions() {
        SecurityUserDetails user = SecurityUtils.getCurrentUser();
        return Result.success(user == null ? Set.of() : roleService.getUserPermissions(user.getUserId()));
    }

    @Operation(summary = "新增角色")
    @RequiresPermission("role:manage")
    @OperateLog(action = "新增角色", target = "角色权限")
    @PostMapping
    public Result<Void> create(@Valid @RequestBody RoleSaveDTO dto) {
        roleService.createRole(dto);
        return Result.success();
    }

    @Operation(summary = "编辑角色")
    @RequiresPermission("role:manage")
    @OperateLog(action = "编辑角色", target = "角色权限")
    @PutMapping("/{id}")
    public Result<Void> update(@PathVariable Long id, @Valid @RequestBody RoleSaveDTO dto) {
        roleService.updateRole(id, dto);
        return Result.success();
    }

    @Operation(summary = "删除角色")
    @RequiresPermission("role:manage")
    @OperateLog(action = "删除角色", target = "角色权限")
    @DeleteMapping("/{id}")
    public Result<Void> delete(@PathVariable Long id) {
        roleService.deleteRole(id);
        return Result.success();
    }
}
