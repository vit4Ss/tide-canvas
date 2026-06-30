package com.tidecanvas.config;

import jakarta.annotation.PostConstruct;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.context.annotation.Configuration;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.mail.javamail.JavaMailSenderImpl;
import org.springframework.util.StringUtils;

/**
 * 为 JavaMail 注入 SMTP 专用 SOCKS5 代理（mail.socks-host 非空时生效）。
 * <p>
 * 不能用 JVM 全局 -DsocksProxyHost：那会把 MySQL/Redis/OSS 等所有 TCP 出站都卷进代理。
 * 这里只往 JavaMailSender 的会话属性写 {@code mail.smtp.socks.*}，影响面仅限发信。
 * 注意属性值必须是字符串，Properties#getProperty 对非 String 值返回 null。
 *
 * @author tidecanvas
 */
@Slf4j
@Configuration
@RequiredArgsConstructor
public class MailSocksConfig {

    private final AppMailProperties mailProperties;
    private final ObjectProvider<JavaMailSender> mailSenderProvider;

    @PostConstruct
    void applySocksProxy() {
        if (!StringUtils.hasText(mailProperties.getSocksHost())) {
            return;
        }
        JavaMailSender sender = mailSenderProvider.getIfAvailable();
        if (sender instanceof JavaMailSenderImpl impl) {
            impl.getJavaMailProperties().setProperty("mail.smtp.socks.host", mailProperties.getSocksHost().trim());
            impl.getJavaMailProperties().setProperty("mail.smtp.socks.port", String.valueOf(mailProperties.getSocksPort()));
            log.info("SMTP SOCKS5 proxy enabled: {}:{}", mailProperties.getSocksHost(), mailProperties.getSocksPort());
        }
    }
}
