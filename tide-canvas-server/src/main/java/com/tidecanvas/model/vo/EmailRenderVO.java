package com.tidecanvas.model.vo;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

/**
 * 邮件模板渲染结果VO
 *
 * @author tidecanvas
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
public class EmailRenderVO {

    /** 渲染后的主题 */
    private String subject;

    /** 渲染后的正文HTML */
    private String html;

    /** 模板中引用但未提供测试值的变量(预览时提示) */
    private List<String> missingVariables;
}
