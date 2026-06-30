package com.tidecanvas.aspect;

import com.tidecanvas.annotation.RateLimit;
import com.tidecanvas.security.SecurityUtils;
import com.tidecanvas.service.security.AbuseGuard;
import com.tidecanvas.util.ClientIpUtils;
import jakarta.servlet.http.HttpServletRequest;
import lombok.RequiredArgsConstructor;
import org.aspectj.lang.ProceedingJoinPoint;
import org.aspectj.lang.annotation.Around;
import org.aspectj.lang.annotation.Aspect;
import org.springframework.stereotype.Component;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;

/**
 * {@link RateLimit} 切面：解析当前用户/IP，委托 {@link AbuseGuard} 执行限流与冷却封禁。
 *
 * @author tidecanvas
 */
@Aspect
@Component
@RequiredArgsConstructor
public class RateLimitAspect {

    private final AbuseGuard abuseGuard;

    @Around("@annotation(rateLimit)")
    public Object around(ProceedingJoinPoint point, RateLimit rateLimit) throws Throwable {
        Long userId = SecurityUtils.getCurrentUserIdOrNull();
        String ip = currentIp();
        String name = rateLimit.name().isEmpty() ? point.getSignature().toShortString() : rateLimit.name();
        abuseGuard.enforce(name, userId, ip, rateLimit.dimension(),
                rateLimit.limit(), rateLimit.period(), rateLimit.banThreshold(), rateLimit.banSeconds());
        return point.proceed();
    }

    private String currentIp() {
        if (RequestContextHolder.getRequestAttributes() instanceof ServletRequestAttributes attrs) {
            HttpServletRequest request = attrs.getRequest();
            return ClientIpUtils.getClientIp(request);
        }
        return null;
    }
}
