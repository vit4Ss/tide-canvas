package com.tidecanvas.annotation;

import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/**
 * 标注接口所需的后台权限码（操作按钮级）。无该权限的管理员调用将被拦截。
 * 超级管理员（role_id 为空或权限含 *）放行。
 *
 * @author tidecanvas
 */
@Target(ElementType.METHOD)
@Retention(RetentionPolicy.RUNTIME)
public @interface RequiresPermission {
    String value();
}
