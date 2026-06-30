package com.tidecanvas.service.impl;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.tidecanvas.common.ResultCode;
import com.tidecanvas.config.AppMailProperties;
import com.tidecanvas.exception.BusinessException;
import com.tidecanvas.mapper.EmailTemplateMapper;
import com.tidecanvas.model.dto.EmailTemplatePreviewDTO;
import com.tidecanvas.model.dto.EmailTemplateSendTestDTO;
import com.tidecanvas.model.dto.EmailTemplateUpdateDTO;
import com.tidecanvas.model.entity.EmailTemplateDO;
import com.tidecanvas.model.vo.EmailRenderVO;
import com.tidecanvas.model.vo.EmailTemplateVO;
import com.tidecanvas.service.EmailTemplateService;
import jakarta.mail.internet.MimeMessage;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.mail.javamail.MimeMessageHelper;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;

import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 邮件模板服务实现:模板编码系统内置,后台仅编辑内容;
 * 变量以 {@code {{name}}} 占位,渲染时替换,未提供的变量保留原样并在预览中提示。
 *
 * @author tidecanvas
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class EmailTemplateServiceImpl implements EmailTemplateService {

    /** 变量占位符:{{name}},允许两侧空白 */
    private static final Pattern VARIABLE_PATTERN = Pattern.compile("\\{\\{\\s*([A-Za-z0-9_]+)\\s*}}");

    private final EmailTemplateMapper templateMapper;
    private final ObjectMapper objectMapper;
    private final ObjectProvider<JavaMailSender> mailSenderProvider;
    private final AppMailProperties mailProperties;

    @Value("${spring.mail.host:}")
    private String mailHost;
    @Value("${spring.mail.username:}")
    private String mailUsername;

    @Override
    public List<EmailTemplateVO> listTemplates() {
        return templateMapper.selectList(
                        new LambdaQueryWrapper<EmailTemplateDO>().orderByAsc(EmailTemplateDO::getId))
                .stream().map(this::toVO).toList();
    }

    @Override
    public EmailTemplateVO getTemplate(Long id) {
        return toVO(requireTemplate(id));
    }

    @Override
    public void updateTemplate(Long id, EmailTemplateUpdateDTO dto) {
        EmailTemplateDO template = requireTemplate(id);
        template.setTemplateName(dto.getTemplateName());
        template.setSubject(dto.getSubject());
        template.setContent(dto.getContent());
        template.setEnabled(dto.getEnabled() != null && dto.getEnabled() == 1 ? 1 : 0);
        template.setRemark(dto.getRemark());
        templateMapper.updateById(template);
        log.info("Email template updated: code={}, enabled={}", template.getTemplateCode(), template.getEnabled());
    }

    @Override
    public EmailRenderVO preview(EmailTemplatePreviewDTO dto) {
        return render(dto.getSubject(), dto.getContent(), dto.getParams());
    }

    @Override
    public Optional<EmailRenderVO> renderByCode(String templateCode, Map<String, String> params) {
        EmailTemplateDO template = templateMapper.selectOne(
                new LambdaQueryWrapper<EmailTemplateDO>().eq(EmailTemplateDO::getTemplateCode, templateCode));
        if (template == null || template.getEnabled() == null || template.getEnabled() != 1) {
            return Optional.empty();
        }
        return Optional.of(render(template.getSubject(), template.getContent(), params));
    }

    @Override
    public void sendTest(Long id, EmailTemplateSendTestDTO dto) {
        EmailTemplateDO template = requireTemplate(id);
        EmailRenderVO rendered = render(template.getSubject(), template.getContent(), dto.getParams());

        JavaMailSender sender = mailSenderProvider.getIfAvailable();
        if (!mailProperties.isEnabled() || !StringUtils.hasText(mailHost) || sender == null) {
            throw new BusinessException(ResultCode.BAD_REQUEST,
                    "邮件服务未启用或未配置SMTP(spring.mail.* / mail.enabled)，无法发送测试邮件");
        }
        try {
            MimeMessage message = sender.createMimeMessage();
            MimeMessageHelper helper = new MimeMessageHelper(message, false, StandardCharsets.UTF_8.name());
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
            helper.setTo(dto.getTo());
            helper.setSubject("[测试] " + rendered.getSubject());
            helper.setText(rendered.getHtml(), true);
            sender.send(message);
            log.info("Test email sent: template={}, to={}", template.getTemplateCode(), dto.getTo());
        } catch (Exception e) {
            log.error("Send test email failed: to={}", dto.getTo(), e);
            throw new BusinessException(ResultCode.SERVER_ERROR, "测试邮件发送失败: " + e.getMessage());
        }
    }

    /**
     * 变量替换:出现于主题/正文的 {{name}} 用 params 替换;未提供的保留原样并记入 missingVariables
     */
    private EmailRenderVO render(String subject, String content, Map<String, String> params) {
        Set<String> missing = new LinkedHashSet<>();
        String renderedSubject = replaceVariables(subject, params, missing);
        String renderedHtml = replaceVariables(content, params, missing);
        return new EmailRenderVO(renderedSubject, renderedHtml, new ArrayList<>(missing));
    }

    private String replaceVariables(String text, Map<String, String> params, Set<String> missing) {
        if (!StringUtils.hasText(text)) {
            return "";
        }
        Matcher matcher = VARIABLE_PATTERN.matcher(text);
        StringBuilder sb = new StringBuilder();
        while (matcher.find()) {
            String name = matcher.group(1);
            String value = params != null ? params.get(name) : null;
            if (value == null) {
                missing.add(name);
                matcher.appendReplacement(sb, Matcher.quoteReplacement(matcher.group()));
            } else {
                matcher.appendReplacement(sb, Matcher.quoteReplacement(value));
            }
        }
        matcher.appendTail(sb);
        return sb.toString();
    }

    private EmailTemplateDO requireTemplate(Long id) {
        EmailTemplateDO template = templateMapper.selectById(id);
        if (template == null) {
            throw new BusinessException(ResultCode.NOT_FOUND, "模板不存在");
        }
        return template;
    }

    private EmailTemplateVO toVO(EmailTemplateDO template) {
        EmailTemplateVO vo = new EmailTemplateVO();
        vo.setId(template.getId());
        vo.setTemplateCode(template.getTemplateCode());
        vo.setTemplateName(template.getTemplateName());
        vo.setSubject(template.getSubject());
        vo.setContent(template.getContent());
        vo.setEnabled(template.getEnabled());
        vo.setRemark(template.getRemark());
        vo.setUpdateTime(template.getUpdateTime());
        vo.setVariables(parseVariables(template.getVariables()));
        return vo;
    }

    private List<EmailTemplateVO.VariableVO> parseVariables(String json) {
        if (!StringUtils.hasText(json)) {
            return List.of();
        }
        try {
            return objectMapper.readValue(json, new TypeReference<>() {
            });
        } catch (Exception e) {
            log.warn("Invalid email template variables json: {}", json);
            return List.of();
        }
    }
}
