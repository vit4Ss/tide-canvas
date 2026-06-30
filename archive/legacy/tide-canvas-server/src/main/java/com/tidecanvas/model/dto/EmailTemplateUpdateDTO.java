package com.tidecanvas.model.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import lombok.Data;

/**
 * 邮件模板更新DTO(模板编码与变量定义由系统内置,不可修改)
 *
 * @author tidecanvas
 */
@Data
public class EmailTemplateUpdateDTO {

    @NotBlank(message = "模板名称不能为空")
    @Size(max = 64, message = "模板名称过长")
    private String templateName;

    @NotBlank(message = "邮件主题不能为空")
    @Size(max = 256, message = "邮件主题过长")
    private String subject;

    @NotBlank(message = "邮件正文不能为空")
    private String content;

    @NotNull(message = "启用状态不能为空")
    private Integer enabled;

    @Size(max = 256, message = "备注过长")
    private String remark;
}
