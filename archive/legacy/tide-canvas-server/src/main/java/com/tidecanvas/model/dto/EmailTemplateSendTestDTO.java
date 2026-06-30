package com.tidecanvas.model.dto;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import lombok.Data;

import java.util.Map;

/**
 * 发送测试邮件DTO
 *
 * @author tidecanvas
 */
@Data
public class EmailTemplateSendTestDTO {

    @NotBlank(message = "收件邮箱不能为空")
    @Email(message = "邮箱格式不正确")
    private String to;

    /** 变量测试值 */
    private Map<String, String> params;
}
