package com.tidecanvas.config;

import lombok.Data;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.context.annotation.Configuration;

/**
 * 反刷流 / 限流配置（prefix=security.rate-limit）。
 *
 * @author tidecanvas
 */
@Data
@Configuration
@ConfigurationProperties(prefix = "security.rate-limit")
public class SecurityRateLimitProperties {

    /** 总开关 */
    private boolean enabled = true;

    /** 违规累计窗口（秒）：在此窗口内累计违规达到各接口 banThreshold 即封禁 */
    private int banWindowSeconds = 600;

    /** 默认封禁时长（秒），用于全局兜底与手动封禁缺省 */
    private int defaultBanSeconds = 600;

    // ===== 全局兜底（对所有 /api 接口；只拦明显的脚本洪流，故阈值放宽） =====

    /** 每 IP 每窗口最大请求数 */
    private int globalIpLimit = 600;

    /** 每用户每窗口最大请求数 */
    private int globalUserLimit = 300;

    /** 全局窗口长度（秒） */
    private int globalPeriod = 60;

    /** 全局兜底违规多少次后封禁 */
    private int globalBanThreshold = 3;
}
