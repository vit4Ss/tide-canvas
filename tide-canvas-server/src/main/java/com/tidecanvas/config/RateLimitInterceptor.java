package com.tidecanvas.config;

import com.tidecanvas.annotation.LimitDimension;
import com.tidecanvas.security.SecurityUtils;
import com.tidecanvas.service.security.AbuseGuard;
import com.tidecanvas.util.ClientIpUtils;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;
import org.springframework.web.servlet.HandlerInterceptor;

/**
 * 全局兜底限流拦截器：对所有 /api 接口按「每 IP / 每用户」总请求数做宽松上限，
 * 拦明显的脚本洪流（覆盖未单独标注 {@link com.tidecanvas.annotation.RateLimit} 的接口）。
 * 超限抛 {@code RATE_LIMIT}，由全局异常处理器转 429 JSON。
 *
 * @author tidecanvas
 */
@Component
@RequiredArgsConstructor
public class RateLimitInterceptor implements HandlerInterceptor {

    private final AbuseGuard abuseGuard;
    private final SecurityRateLimitProperties props;

    @Override
    public boolean preHandle(HttpServletRequest request, HttpServletResponse response, Object handler) {
        if (!props.isEnabled()) {
            return true;
        }
        Long userId = SecurityUtils.getCurrentUserIdOrNull();
        String ip = ClientIpUtils.getClientIp(request);
        // 用户与 IP 分别按各自上限计数（IP 上限更宽，避免 NAT 多用户共享 IP 被误伤）
        if (userId != null) {
            abuseGuard.enforce("global-user", userId, ip, LimitDimension.USER,
                    props.getGlobalUserLimit(), props.getGlobalPeriod(), props.getGlobalBanThreshold(), props.getDefaultBanSeconds());
        }
        abuseGuard.enforce("global-ip", null, ip, LimitDimension.IP,
                props.getGlobalIpLimit(), props.getGlobalPeriod(), props.getGlobalBanThreshold(), props.getDefaultBanSeconds());
        return true;
    }
}
