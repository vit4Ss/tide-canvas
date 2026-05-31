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

@Slf4j
@Aspect
@Component
@RequiredArgsConstructor
public class OperateLogAspect {

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
            logDO.setCreateTime(LocalDateTime.now());
            logMapper.insert(logDO);
        } catch (Exception e) {
            log.warn("记录操作日志失败", e);
        }
        return result;
    }
}
