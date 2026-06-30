package com.tidecanvas.aspect;

import com.tidecanvas.annotation.RequiresPermission;
import com.tidecanvas.common.ResultCode;
import com.tidecanvas.constant.AdminPermissions;
import com.tidecanvas.exception.BusinessException;
import com.tidecanvas.security.SecurityUserDetails;
import com.tidecanvas.security.SecurityUtils;
import com.tidecanvas.service.AdminRoleService;
import lombok.RequiredArgsConstructor;
import org.aspectj.lang.annotation.Aspect;
import org.aspectj.lang.annotation.Before;
import org.springframework.stereotype.Component;

import java.util.Set;

/**
 * 权限校验切面：拦截 @RequiresPermission 标注的接口，校验当前管理员是否具备所需权限码。
 *
 * @author tidecanvas
 */
@Aspect
@Component
@RequiredArgsConstructor
public class PermissionAspect {

    private final AdminRoleService roleService;

    @Before("@annotation(requiresPermission)")
    public void check(RequiresPermission requiresPermission) {
        SecurityUserDetails user = SecurityUtils.getCurrentUser();
        if (user == null) {
            throw new BusinessException(ResultCode.UNAUTHORIZED);
        }
        Set<String> perms = roleService.getUserPermissions(user.getUserId());
        if (perms.contains(AdminPermissions.WILDCARD)) {
            return;
        }
        if (!perms.contains(requiresPermission.value())) {
            throw new BusinessException(ResultCode.FORBIDDEN, "无权限：" + requiresPermission.value());
        }
    }
}
