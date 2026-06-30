package com.tidecanvas.annotation;

/**
 * 限流维度：按谁计数与封禁。
 *
 * @author tidecanvas
 */
public enum LimitDimension {
    /** 按当前登录用户（认证接口） */
    USER,
    /** 按客户端 IP（匿名接口，如登录/注册） */
    IP,
    /** 同时按用户与 IP，任一超限即拦截（最严，适合 AI 生成等贵操作） */
    USER_AND_IP
}
