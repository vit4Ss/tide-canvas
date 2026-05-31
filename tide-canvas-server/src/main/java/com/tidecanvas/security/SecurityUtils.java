package com.tidecanvas.security;

import org.springframework.security.core.Authentication;
import org.springframework.security.core.AuthenticationException;
import org.springframework.security.core.context.SecurityContextHolder;

public final class SecurityUtils {

    private SecurityUtils() {
    }

    /**
     * 获取当前用户ID，未认证时抛出 AuthenticationException。
     */
    public static Long getCurrentUserId() {
        Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
        if (authentication == null || !authentication.isAuthenticated()) {
            throw new AuthenticationException("未登录或 Token 已过期") {};
        }
        if (authentication.getPrincipal() instanceof SecurityUserDetails userDetails) {
            return userDetails.getUserId();
        }
        throw new AuthenticationException("无法获取当前用户信息") {};
    }

    /**
     * 获取当前用户，未认证时返回 null（用于公开接口中可选认证场景）。
     */
    public static Long getCurrentUserIdOrNull() {
        try {
            return getCurrentUserId();
        } catch (AuthenticationException e) {
            return null;
        }
    }

    public static SecurityUserDetails getCurrentUser() {
        Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
        if (authentication == null || !authentication.isAuthenticated()) {
            throw new AuthenticationException("未登录或 Token 已过期") {};
        }
        if (authentication.getPrincipal() instanceof SecurityUserDetails userDetails) {
            return userDetails;
        }
        throw new AuthenticationException("无法获取当前用户信息") {};
    }

    public static boolean isAdmin() {
        try {
            SecurityUserDetails user = getCurrentUser();
            return user.getRole() == 9;
        } catch (AuthenticationException e) {
            return false;
        }
    }
}
