package com.tidecanvas.annotation;

import java.lang.annotation.*;

/**
 * 接口限流 + 反刷流。
 * <p>
 * 在 {@code period} 秒内最多 {@code limit} 次（按 {@code dimension} 维度计数）；超限拒绝当次。
 * 当 {@code banThreshold > 0}：违规累计在封禁窗口内达到该值，则把该用户/IP 冷却封禁
 * {@code banSeconds} 秒（期间所有受保护接口直接拒绝），并记录到操作日志（abuse_block）。
 *
 * @author tidecanvas
 */
@Target(ElementType.METHOD)
@Retention(RetentionPolicy.RUNTIME)
@Documented
public @interface RateLimit {

    /** 限流名（用于 Redis key 与告警记录）；空则用方法签名 */
    String name() default "";

    /** 窗口内最大次数 */
    int limit() default 60;

    /** 窗口长度（秒） */
    int period() default 60;

    /** 计数与封禁维度 */
    LimitDimension dimension() default LimitDimension.USER;

    /** 触发封禁所需的违规累计次数；0 表示只拒绝当次、不封禁 */
    int banThreshold() default 0;

    /** 封禁冷却时长（秒） */
    int banSeconds() default 600;
}
