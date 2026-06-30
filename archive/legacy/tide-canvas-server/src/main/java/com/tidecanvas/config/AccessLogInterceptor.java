package com.tidecanvas.config;

import com.tidecanvas.model.entity.AccessLogDO;
import com.tidecanvas.security.SecurityUserDetails;
import com.tidecanvas.security.SecurityUtils;
import com.tidecanvas.service.log.AccessLogRecorder;
import com.tidecanvas.util.IpUtil;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;
import org.springframework.web.servlet.HandlerInterceptor;

import java.time.LocalDateTime;
import java.time.ZoneId;

/**
 * 访问日志拦截器：记录每次请求的路径/方法/状态/耗时/用户/IP/UA，异步落库。
 *
 * @author tidecanvas
 */
@Component
@RequiredArgsConstructor
public class AccessLogInterceptor implements HandlerInterceptor {

    private static final ZoneId BEIJING_ZONE = ZoneId.of("Asia/Shanghai");
    private static final String START_ATTR = "_access_log_start";
    private static final int MAX_PATH = 255;
    private static final int MAX_TEXT = 500;

    private final AccessLogRecorder recorder;

    @Override
    public boolean preHandle(HttpServletRequest request, HttpServletResponse response, Object handler) {
        request.setAttribute(START_ATTR, System.currentTimeMillis());
        return true;
    }

    @Override
    public void afterCompletion(HttpServletRequest request, HttpServletResponse response, Object handler, Exception ex) {
        try {
            Object start = request.getAttribute(START_ATTR);
            long duration = start instanceof Long s ? System.currentTimeMillis() - s : 0L;

            AccessLogDO log = new AccessLogDO();
            log.setMethod(request.getMethod());
            log.setPath(truncate(request.getRequestURI(), MAX_PATH));
            log.setQuery(truncate(request.getQueryString(), MAX_TEXT));
            log.setStatus(response.getStatus());
            log.setDurationMs(duration);
            log.setIp(IpUtil.getClientIp(request));
            log.setUserAgent(truncate(request.getHeader("User-Agent"), MAX_TEXT));

            SecurityUserDetails user = SecurityUtils.getCurrentUser();
            if (user != null) {
                log.setUserId(user.getUserId());
                log.setUsername(user.getUsername());
            }
            log.setCreateTime(LocalDateTime.now(BEIJING_ZONE));
            recorder.save(log);
        } catch (Exception ignore) {
            // 访问日志记录失败不影响请求本身
        }
    }

    private String truncate(String value, int max) {
        if (value == null) {
            return null;
        }
        return value.length() > max ? value.substring(0, max) : value;
    }
}
