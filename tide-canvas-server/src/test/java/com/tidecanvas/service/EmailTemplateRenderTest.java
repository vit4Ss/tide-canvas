package com.tidecanvas.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.tidecanvas.config.AppMailProperties;
import com.tidecanvas.model.dto.EmailTemplatePreviewDTO;
import com.tidecanvas.model.vo.EmailRenderVO;
import com.tidecanvas.service.impl.EmailTemplateServiceImpl;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * 邮件模板变量渲染测试(preview 不依赖数据库/邮件服务)
 */
class EmailTemplateRenderTest {

    private final EmailTemplateServiceImpl service =
            new EmailTemplateServiceImpl(null, new ObjectMapper(), null, new AppMailProperties());

    @Test
    void replacesVariablesAndReportsMissing() {
        EmailTemplatePreviewDTO dto = new EmailTemplatePreviewDTO();
        dto.setSubject("{{siteName}} 验证码");
        dto.setContent("<b>{{ code }}</b> 有效期 {{ttlMinutes}} 分钟,发往 {{unknown}}");
        dto.setParams(Map.of("siteName", "TideCanvas", "code", "888888", "ttlMinutes", "5"));

        EmailRenderVO result = service.preview(dto);

        assertEquals("TideCanvas 验证码", result.getSubject());
        assertEquals("<b>888888</b> 有效期 5 分钟,发往 {{unknown}}", result.getHtml());
        assertEquals(List.of("unknown"), result.getMissingVariables());
    }

    @Test
    void keepsTextWithoutVariablesUntouched() {
        EmailTemplatePreviewDTO dto = new EmailTemplatePreviewDTO();
        dto.setSubject("纯文本主题");
        dto.setContent("<p>没有占位符 {单braces} 不受影响</p>");
        dto.setParams(Map.of());

        EmailRenderVO result = service.preview(dto);

        assertEquals("纯文本主题", result.getSubject());
        assertEquals("<p>没有占位符 {单braces} 不受影响</p>", result.getHtml());
        assertTrue(result.getMissingVariables().isEmpty());
    }

    @Test
    void replacementValueWithSpecialCharsIsLiteral() {
        EmailTemplatePreviewDTO dto = new EmailTemplatePreviewDTO();
        dto.setSubject("s");
        dto.setContent("{{v}}");
        // $ 与 \ 在 Matcher.appendReplacement 中有特殊含义,须按字面量替换
        dto.setParams(Map.of("v", "a$b\\c"));

        assertEquals("a$b\\c", service.preview(dto).getHtml());
    }
}
