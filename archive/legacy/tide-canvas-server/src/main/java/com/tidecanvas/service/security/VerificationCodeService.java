package com.tidecanvas.service.security;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.tidecanvas.common.ResultCode;
import com.tidecanvas.config.AppMailProperties;
import com.tidecanvas.exception.BusinessException;
import com.tidecanvas.mapper.SysConfigMapper;
import com.tidecanvas.model.entity.SysConfigDO;
import com.tidecanvas.model.vo.EmailRenderVO;
import com.tidecanvas.service.EmailTemplateService;
import jakarta.mail.internet.MimeMessage;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.redis.core.RedisTemplate;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.mail.javamail.MimeMessageHelper;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;

import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.ThreadLocalRandom;
import java.util.concurrent.TimeUnit;

/**
 * 验证码服务：生成 6 位码存 Redis，按渠道下发并校验。
 * <p>
 * 邮箱渠道：{@code mail.enabled=true} 且配置了 {@code spring.mail.host} 时 SMTP 真发；
 * 否则回退「开发模式」——验证码打到日志，便于本地联调。
 * <p>
 * 防滥用（与接口层 IP 限流互补）：同一邮箱 {@code mail.resend-cooldown-seconds} 内不可重发；
 * 校验错误达 {@code mail.max-attempts} 次后验证码作废，需重新获取（防爆破）。
 * <p>
 * 邮件内容优先使用 {@code register_code} 邮件模板（管理后台可编辑、HTML），
 * 模板缺失或停用时回退内置纯文本，保证验证码始终可发。
 *
 * @author tidecanvas
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class VerificationCodeService {

    /** 注册验证码邮件模板编码 */
    public static final String TEMPLATE_REGISTER_CODE = "register_code";

    private final RedisTemplate<String, Object> redisTemplate;
    private final ObjectProvider<JavaMailSender> mailSenderProvider;
    private final EmailTemplateService emailTemplateService;
    private final SysConfigMapper configMapper;
    private final AppMailProperties mailProperties;

    @Value("${spring.mail.host:}")
    private String mailHost;
    @Value("${spring.mail.username:}")
    private String mailUsername;

    public void sendEmailCode(String email) {
        enforceResendCooldown(email);

        String code = String.valueOf(ThreadLocalRandom.current().nextInt(100000, 1000000));
        long ttlSeconds = Math.max(60, mailProperties.getCodeTtlSeconds());
        redisTemplate.opsForValue().set(key("email", email), code, ttlSeconds, TimeUnit.SECONDS);
        redisTemplate.delete(failKey(email));

        JavaMailSender sender = mailSenderProvider.getIfAvailable();
        if (mailProperties.isEnabled() && StringUtils.hasText(mailHost) && sender != null) {
            try {
                sendCodeMail(sender, email, code, ttlSeconds / 60);
            } catch (Exception e) {
                log.error("发送邮箱验证码失败: {}", email, e);
                // 发送失败不应占用冷却窗口，允许用户立即重试
                redisTemplate.delete(cooldownKey(email));
                throw new BusinessException(ResultCode.SERVER_ERROR, "验证码发送失败，请稍后重试");
            }
        } else {
            // 渠道关闭或未配置 SMTP → 开发模式：验证码打到日志
            log.warn("【开发模式·邮件未启用】邮箱 {} 的注册验证码：{}（{} 分钟内有效）", email, code, ttlSeconds / 60);
        }
    }

    public void verifyEmailCode(String email, String code) {
        Object stored = redisTemplate.opsForValue().get(key("email", email));
        if (stored == null) {
            throw new BusinessException(ResultCode.BAD_REQUEST, "验证码不存在或已过期");
        }
        if (!stored.toString().equals(code)) {
            registerFailedAttempt(email);
            throw new BusinessException(ResultCode.BAD_REQUEST, "验证码错误");
        }
        redisTemplate.delete(key("email", email));
        redisTemplate.delete(failKey(email));
    }

    /**
     * 同邮箱重发冷却：SETNX 抢占,占用期间拒绝重发(发送失败时由发送方释放)
     */
    private void enforceResendCooldown(String email) {
        int cooldown = mailProperties.getResendCooldownSeconds();
        if (cooldown <= 0) {
            return;
        }
        Boolean acquired = redisTemplate.opsForValue()
                .setIfAbsent(cooldownKey(email), "1", Duration.ofSeconds(cooldown));
        if (!Boolean.TRUE.equals(acquired)) {
            throw new BusinessException(ResultCode.RATE_LIMIT,
                    "验证码发送过于频繁，请 " + cooldown + " 秒后再试");
        }
    }

    /**
     * 错误尝试计数：达到上限作废验证码,防 6 位码窗口内爆破
     */
    private void registerFailedAttempt(String email) {
        int maxAttempts = mailProperties.getMaxAttempts();
        if (maxAttempts <= 0) {
            return;
        }
        Long fails = redisTemplate.opsForValue().increment(failKey(email));
        if (fails != null && fails == 1L) {
            redisTemplate.expire(failKey(email), Math.max(60, mailProperties.getCodeTtlSeconds()), TimeUnit.SECONDS);
        }
        if (fails != null && fails >= maxAttempts) {
            redisTemplate.delete(key("email", email));
            redisTemplate.delete(failKey(email));
            throw new BusinessException(ResultCode.BAD_REQUEST, "验证码错误次数过多，已失效，请重新获取");
        }
    }

    /**
     * 优先用后台可编辑的 HTML 模板发送;模板缺失/停用时回退内置纯文本
     */
    private void sendCodeMail(JavaMailSender sender, String email, String code, long ttlMinutes) throws Exception {
        String siteName = getSiteName();
        Optional<EmailRenderVO> rendered = emailTemplateService.renderByCode(TEMPLATE_REGISTER_CODE, Map.of(
                "code", code,
                "siteName", siteName,
                "ttlMinutes", String.valueOf(ttlMinutes),
                "email", email));

        MimeMessage message = sender.createMimeMessage();
        MimeMessageHelper helper = new MimeMessageHelper(message, false, StandardCharsets.UTF_8.name());
        applySenderIdentity(helper);
        helper.setTo(email);
        if (rendered.isPresent()) {
            helper.setSubject(rendered.get().getSubject());
            helper.setText(rendered.get().getHtml(), true);
        } else {
            helper.setSubject(siteName + " 注册验证码");
            helper.setText("您的验证码是：" + code + "，" + ttlMinutes + " 分钟内有效。如非本人操作请忽略。", false);
        }
        sender.send(message);
    }

    /**
     * 发件人身份：from-address(空回退 SMTP 账号) + 显示名 + reply-to
     */
    private void applySenderIdentity(MimeMessageHelper helper) throws Exception {
        String from = StringUtils.hasText(mailProperties.getFromAddress())
                ? mailProperties.getFromAddress() : mailUsername;
        if (StringUtils.hasText(from)) {
            if (StringUtils.hasText(mailProperties.getFromName())) {
                helper.setFrom(from, mailProperties.getFromName());
            } else {
                helper.setFrom(from);
            }
        }
        if (StringUtils.hasText(mailProperties.getReplyTo())) {
            helper.setReplyTo(mailProperties.getReplyTo());
        }
    }

    private String getSiteName() {
        try {
            SysConfigDO config = configMapper.selectOne(
                    new LambdaQueryWrapper<SysConfigDO>().eq(SysConfigDO::getConfigKey, "site.name"));
            if (config != null && StringUtils.hasText(config.getConfigValue())) {
                return config.getConfigValue();
            }
        } catch (Exception e) {
            log.warn("读取站点名称失败,使用默认值", e);
        }
        return "TideCanvas";
    }

    private String key(String channel, String target) {
        return "vcode:" + channel + ":" + target;
    }

    private String cooldownKey(String email) {
        return "vcode:cooldown:email:" + email;
    }

    private String failKey(String email) {
        return "vcode:fail:email:" + email;
    }
}
