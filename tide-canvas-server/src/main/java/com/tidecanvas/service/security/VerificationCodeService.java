package com.tidecanvas.service.security;

import com.tidecanvas.common.ResultCode;
import com.tidecanvas.exception.BusinessException;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.redis.core.RedisTemplate;
import org.springframework.mail.SimpleMailMessage;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;

import java.util.concurrent.ThreadLocalRandom;
import java.util.concurrent.TimeUnit;

/**
 * 验证码服务：生成 6 位码存 Redis（5 分钟），按渠道下发并校验。
 * <p>
 * 邮箱渠道：配置了 {@code spring.mail.host} 则用 SMTP 真发；否则回退「开发模式」——把验证码打到日志，
 * 便于本地联调，无需外部邮件服务。
 *
 * @author tidecanvas
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class VerificationCodeService {

    private final RedisTemplate<String, Object> redisTemplate;
    private final ObjectProvider<JavaMailSender> mailSenderProvider;

    @Value("${spring.mail.host:}")
    private String mailHost;
    @Value("${spring.mail.username:}")
    private String mailFrom;

    private static final long CODE_TTL_SECONDS = 300;

    public void sendEmailCode(String email) {
        String code = String.valueOf(ThreadLocalRandom.current().nextInt(100000, 1000000));
        redisTemplate.opsForValue().set(key("email", email), code, CODE_TTL_SECONDS, TimeUnit.SECONDS);
        JavaMailSender sender = mailSenderProvider.getIfAvailable();
        if (StringUtils.hasText(mailHost) && sender != null) {
            try {
                SimpleMailMessage msg = new SimpleMailMessage();
                if (StringUtils.hasText(mailFrom)) {
                    msg.setFrom(mailFrom);
                }
                msg.setTo(email);
                msg.setSubject("TideCanvas 注册验证码");
                msg.setText("您的验证码是：" + code + "，5 分钟内有效。如非本人操作请忽略。");
                sender.send(msg);
            } catch (Exception e) {
                log.error("发送邮箱验证码失败: {}", email, e);
                throw new BusinessException(ResultCode.SERVER_ERROR, "验证码发送失败，请稍后重试");
            }
        } else {
            // 未配置 SMTP → 开发模式：验证码打到日志（生产请在 spring.mail.* 配置邮箱账号）
            log.warn("【开发模式·未配置SMTP】邮箱 {} 的注册验证码：{}（5 分钟内有效）", email, code);
        }
    }

    public void verifyEmailCode(String email, String code) {
        Object stored = redisTemplate.opsForValue().get(key("email", email));
        if (stored == null) {
            throw new BusinessException(ResultCode.BAD_REQUEST, "验证码不存在或已过期");
        }
        if (!stored.toString().equals(code)) {
            throw new BusinessException(ResultCode.BAD_REQUEST, "验证码错误");
        }
        redisTemplate.delete(key("email", email));
    }

    private String key(String channel, String target) {
        return "vcode:" + channel + ":" + target;
    }
}
