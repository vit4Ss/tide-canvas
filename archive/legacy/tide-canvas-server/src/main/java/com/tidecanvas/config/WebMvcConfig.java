package com.tidecanvas.config;

import lombok.RequiredArgsConstructor;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.InterceptorRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

/**
 * MVC 配置：注册全局兜底限流拦截器 + 访问日志拦截器。
 *
 * @author tidecanvas
 */
@Configuration
@RequiredArgsConstructor
public class WebMvcConfig implements WebMvcConfigurer {

    private final RateLimitInterceptor rateLimitInterceptor;
    private final AccessLogInterceptor accessLogInterceptor;

    @Override
    public void addInterceptors(InterceptorRegistry registry) {
        registry.addInterceptor(rateLimitInterceptor)
                .addPathPatterns("/api/**")
                // 文档与下载代理不计入兜底;支付网关回调来自固定出口 IP 且会重试,不可被限流误伤
                .excludePathPatterns("/api/files/download", "/api/orders/notify/**", "/doc.html", "/webjars/**", "/v3/api-docs/**", "/swagger-resources/**");

        registry.addInterceptor(accessLogInterceptor)
                .addPathPatterns("/api/**")
                // 排除：日志查询接口与数据面板(避免后台自身浏览日志/面板轮询造成自噬式噪声)、文档、下载代理
                .excludePathPatterns(
                        "/api/admin/access-logs/**", "/api/admin/login-logs/**",
                        "/api/admin/dashboard/**", "/api/admin/logs/**", "/api/admin/monitor/**",
                        "/api/files/download", "/api/orders/notify/**",
                        "/doc.html", "/webjars/**", "/v3/api-docs/**", "/swagger-resources/**");
    }
}
