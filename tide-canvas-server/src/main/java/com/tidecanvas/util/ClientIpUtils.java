package com.tidecanvas.util;

import jakarta.servlet.http.HttpServletRequest;
import org.springframework.util.StringUtils;

/**
 * 客户端真实 IP 提取。
 * <p>
 * 服务部署在反向代理（Next.js rewrite / nginx）之后，{@code getRemoteAddr()} 拿到的是代理 IP，
 * 故优先取 {@code X-Forwarded-For} 链首段。需确保代理层正确透传该头，否则 IP 维度限流会退化为按代理 IP。
 *
 * @author tidecanvas
 */
public final class ClientIpUtils {

    private ClientIpUtils() {
    }

    private static final String UNKNOWN = "unknown";

    public static String getClientIp(HttpServletRequest request) {
        if (request == null) {
            return UNKNOWN;
        }
        String ip = firstValid(request.getHeader("X-Forwarded-For"));
        if (ip == null) {
            ip = headerIfValid(request.getHeader("X-Real-IP"));
        }
        if (ip == null) {
            ip = request.getRemoteAddr();
        }
        if (!StringUtils.hasText(ip)) {
            return UNKNOWN;
        }
        // 去掉可能的端口（IPv4:port）；IPv6 含多个冒号，原样保留
        int colon = ip.indexOf(':');
        if (colon > 0 && ip.indexOf(':', colon + 1) < 0) {
            ip = ip.substring(0, colon);
        }
        return ip;
    }

    /** X-Forwarded-For 可能是 "client, proxy1, proxy2"，取第一个非 unknown 段 */
    private static String firstValid(String xff) {
        if (!StringUtils.hasText(xff)) {
            return null;
        }
        for (String part : xff.split(",")) {
            String p = part.trim();
            if (StringUtils.hasText(p) && !UNKNOWN.equalsIgnoreCase(p)) {
                return p;
            }
        }
        return null;
    }

    private static String headerIfValid(String h) {
        return (StringUtils.hasText(h) && !UNKNOWN.equalsIgnoreCase(h)) ? h.trim() : null;
    }
}
