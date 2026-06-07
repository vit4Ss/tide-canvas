package com.tidecanvas.config;

import lombok.RequiredArgsConstructor;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.InterceptorRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

/**
 * MVC 配置：注册全局兜底限流拦截器。
 *
 * @author tidecanvas
 */
@Configuration
@RequiredArgsConstructor
public class WebMvcConfig implements WebMvcConfigurer {

    private final RateLimitInterceptor rateLimitInterceptor;

    @Override
    public void addInterceptors(InterceptorRegistry registry) {
        registry.addInterceptor(rateLimitInterceptor)
                .addPathPatterns("/api/**")
                // 文档与下载代理不计入兜底
                .excludePathPatterns("/api/files/download", "/doc.html", "/webjars/**", "/v3/api-docs/**", "/swagger-resources/**");
    }
}
