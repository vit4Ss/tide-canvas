package com.tidecanvas.util;

import com.tidecanvas.common.ResultCode;
import com.tidecanvas.exception.BusinessException;
import org.springframework.util.StringUtils;

import java.net.InetAddress;
import java.net.URI;

/**
 * 防 SSRF 的 URL 校验：服务端代理拉取外部地址前，确保目标是 http/https 公网地址，
 * 拒绝内网 / 环回 / 链路本地（含云元数据 169.254.169.254）/ CGNAT / IPv6 ULA 等。
 *
 * @author tidecanvas
 */
public final class SafeUrl {

    private SafeUrl() {
    }

    /** 不安全则抛 {@link BusinessException}。 */
    public static void assertPublicHttp(String url) {
        URI uri;
        try {
            uri = URI.create(url);
        } catch (Exception e) {
            throw new BusinessException(ResultCode.BAD_REQUEST, "非法地址");
        }
        String scheme = uri.getScheme();
        if (scheme == null || !(scheme.equalsIgnoreCase("http") || scheme.equalsIgnoreCase("https"))) {
            throw new BusinessException(ResultCode.BAD_REQUEST, "仅允许 http/https 地址");
        }
        String host = uri.getHost();
        if (!StringUtils.hasText(host)) {
            throw new BusinessException(ResultCode.BAD_REQUEST, "非法地址");
        }
        InetAddress[] addrs;
        try {
            addrs = InetAddress.getAllByName(host);
        } catch (Exception e) {
            throw new BusinessException(ResultCode.BAD_REQUEST, "无法解析的地址");
        }
        for (InetAddress addr : addrs) {
            if (isBlocked(addr)) {
                throw new BusinessException(ResultCode.BAD_REQUEST, "禁止访问该地址");
            }
        }
    }

    private static boolean isBlocked(InetAddress addr) {
        // 环回 / 通配 / 链路本地(含 169.254.169.254 云元数据) / 私网 / 组播
        if (addr.isLoopbackAddress() || addr.isAnyLocalAddress() || addr.isLinkLocalAddress()
                || addr.isSiteLocalAddress() || addr.isMulticastAddress()) {
            return true;
        }
        byte[] b = addr.getAddress();
        if (b.length == 4) {
            int b0 = b[0] & 0xff, b1 = b[1] & 0xff;
            // 100.64.0.0/10 运营商级 NAT(CGNAT)
            if (b0 == 100 && b1 >= 64 && b1 <= 127) {
                return true;
            }
        }
        // IPv6 ULA fc00::/7
        return b.length == 16 && (b[0] & 0xfe) == 0xfc;
    }
}
