package com.tidecanvas.model.dto;

import jakarta.validation.constraints.NotBlank;
import lombok.Data;

import java.util.Map;

/**
 * 邮件模板预览DTO:直接传编辑中的主题/正文与测试参数,无需先保存
 *
 * @author tidecanvas
 */
@Data
public class EmailTemplatePreviewDTO {

    @NotBlank(message = "邮件主题不能为空")
    private String subject;

    @NotBlank(message = "邮件正文不能为空")
    private String content;

    /** 变量测试值,如 {"code":"123456"} */
    private Map<String, String> params;
}
