package com.tidecanvas.common;

import lombok.AllArgsConstructor;
import lombok.Getter;

@Getter
@AllArgsConstructor
public enum ResultCode {
    SUCCESS(200, "操作成功"),
    BAD_REQUEST(400, "请求参数错误"),
    UNAUTHORIZED(401, "未登录或Token已过期"),
    FORBIDDEN(403, "无权限访问"),
    NOT_FOUND(404, "资源不存在"),
    RATE_LIMIT(429, "请求频率超限"),
    SERVER_ERROR(500, "系统内部错误"),

    USERNAME_EXISTS(1001, "用户名已存在"),
    EMAIL_EXISTS(1002, "邮箱已注册"),
    PASSWORD_INCORRECT(1003, "密码不正确"),
    ACCOUNT_DISABLED(1004, "账号已被禁用"),
    ACCOUNT_NOT_FOUND(1005, "账号不存在"),

    AI_QUOTA_INSUFFICIENT(2001, "AI调用额度不足"),
    MODEL_UNAVAILABLE(2002, "模型不可用"),
    HANDLER_NOT_FOUND(2003, "Handler不存在"),
    AI_TASK_FAILED(2004, "AI任务执行失败"),
    POINTS_INSUFFICIENT(2010, "积分不足"),
    ALREADY_CHECKED_IN(2011, "今日已签到"),
    NOT_AUTHOR(2012, "非签约作者，无法发布博客"),
    BLOG_ALREADY_PURCHASED(2013, "已购买该博客"),
    ORDER_STATUS_ERROR(2014, "订单状态异常"),
    REDEEM_CODE_INVALID(2020, "兑换码无效"),
    REDEEM_CODE_USED(2021, "兑换码已被使用"),
    REDEEM_CODE_EXPIRED(2022, "兑换码已过期"),
    REDEEM_CODE_DISABLED(2023, "兑换码已停用"),

    FILE_TYPE_NOT_ALLOWED(3001, "文件类型不允许"),
    FILE_SIZE_EXCEEDED(3002, "文件大小超限"),
    STORAGE_INSUFFICIENT(3003, "存储空间不足");

    private final int code;
    private final String message;
}
