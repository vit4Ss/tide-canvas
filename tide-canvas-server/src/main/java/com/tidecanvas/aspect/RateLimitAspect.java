package com.tidecanvas.aspect;

import com.tidecanvas.annotation.RateLimit;
import com.tidecanvas.common.ResultCode;
import com.tidecanvas.exception.BusinessException;
import com.tidecanvas.security.SecurityUtils;
import lombok.RequiredArgsConstructor;
import org.aspectj.lang.ProceedingJoinPoint;
import org.aspectj.lang.annotation.Around;
import org.aspectj.lang.annotation.Aspect;
import org.springframework.data.redis.core.RedisTemplate;
import org.springframework.stereotype.Component;

import java.util.concurrent.TimeUnit;

@Aspect
@Component
@RequiredArgsConstructor
public class RateLimitAspect {

    private final RedisTemplate<String, Object> redisTemplate;

    @Around("@annotation(rateLimit)")
    public Object around(ProceedingJoinPoint point, RateLimit rateLimit) throws Throwable {
        Long userId = SecurityUtils.getCurrentUserId();
        String key = "rate_limit:" + point.getSignature().toShortString() + ":" + userId;
        Long count = redisTemplate.opsForValue().increment(key);
        if (count != null && count == 1) {
            redisTemplate.expire(key, rateLimit.period(), TimeUnit.SECONDS);
        }
        if (count != null && count > rateLimit.limit()) {
            throw new BusinessException(ResultCode.RATE_LIMIT);
        }
        return point.proceed();
    }
}
