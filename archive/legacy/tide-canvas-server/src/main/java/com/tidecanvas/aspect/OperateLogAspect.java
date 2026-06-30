package com.tidecanvas.aspect;

import com.tidecanvas.annotation.OperateLog;
import com.tidecanvas.mapper.SysLogMapper;
import com.tidecanvas.model.entity.SysLogDO;
import com.tidecanvas.security.SecurityUtils;
import com.tidecanvas.security.SecurityUserDetails;
import com.tidecanvas.util.IpUtil;
import jakarta.servlet.http.HttpServletRequest;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.aspectj.lang.ProceedingJoinPoint;
import org.aspectj.lang.annotation.Around;
import org.aspectj.lang.annotation.Aspect;
import org.aspectj.lang.reflect.MethodSignature;
import org.springframework.stereotype.Component;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;

import java.time.LocalDateTime;
import java.time.ZoneId;

@Slf4j
@Aspect
@Component
@RequiredArgsConstructor
public class OperateLogAspect {

    /** 操作日志统一记录北京时间，避免受 JVM 默认时区影响 */
    private static final ZoneId BEIJING_ZONE = ZoneId.of("Asia/Shanghai");

    private final SysLogMapper logMapper;

    @Around("@annotation(operateLog)")
    public Object around(ProceedingJoinPoint point, OperateLog operateLog) throws Throwable {
        Object result = point.proceed();
        try {
            SysLogDO logDO = new SysLogDO();
            SecurityUserDetails user = SecurityUtils.getCurrentUser();
            if (user != null) {
                logDO.setUserId(user.getUserId());
                logDO.setUsername(user.getUsername());
            }
            logDO.setAction(operateLog.action());
            logDO.setTarget(operateLog.target());
            logDO.setDetail(point.getSignature().toShortString());
            ServletRequestAttributes attrs = (ServletRequestAttributes) RequestContextHolder.getRequestAttributes();
            if (attrs != null) {
                HttpServletRequest request = attrs.getRequest();
                logDO.setIp(IpUtil.getClientIp(request));
            }
            logDO.setCreateTime(LocalDateTime.now(BEIJING_ZONE));
            logMapper.insert(logDO);
        } catch (Exception e) {
            log.warn("记录操作日志失败", e);
        }
        return result;
    }
}
