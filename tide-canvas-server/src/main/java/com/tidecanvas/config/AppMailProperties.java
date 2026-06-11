package com.tidecanvas.config;

import lombok.Data;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.context.annotation.Configuration;

/**
 * 邮件业务配置（prefix=mail）。
 * <p>
 * SMTP 连接参数在 Spring 标准 {@code spring.mail.*}；本类只承载业务语义：
 * 发件人展示、验证码时效与防滥用阈值。{@code enabled=false} 时邮件渠道整体降级为
 * 开发模式（验证码打日志），与未配置 SMTP host 等效。
 *
 * @author tidecanvas
 */
@Data
@Configuration
@ConfigurationProperties(prefix = "mail")
public class AppMailProperties {

    /** 邮件渠道总开关：false 时验证码走日志（开发模式），测试邮件接口报错提示 */
    private boolean enabled = true;

    /** 发件地址：留空回退 spring.mail.username（Gmail 等多数 SMTP 要求与登录账号一致） */
    private String fromAddress;

    /** 发件人显示名，如 ScarecrowToken */
    private String fromName;

    /** 用户回信落地邮箱：留空回退发件地址；from 为 no-reply 中继时应配真实客服邮箱 */
    private String replyTo;

    /** 验证码有效期（秒） */
    private int codeTtlSeconds = 600;

    /** 同一邮箱重发冷却（秒） */
    private int resendCooldownSeconds = 60;

    /** 验证码最大错误尝试次数，达到后作废需重新获取 */
    private int maxAttempts = 5;

    /**
     * SMTP 专用 SOCKS5 代理主机：留空不启用。
     * 仅作用于 JavaMail（不影响 MySQL/Redis/OSS 等其他出站连接）。
     * 典型场景：服务器无法直连 Gmail，但宿主机/旁路机有代理（如 Docker 容器经
     * host.docker.internal 走宿主机 Clash 的混合端口）。
     */
    private String socksHost;

    /** SMTP SOCKS5 代理端口 */
    private int socksPort = 7897;
}
