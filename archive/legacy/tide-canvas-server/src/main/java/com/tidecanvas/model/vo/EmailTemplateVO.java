package com.tidecanvas.model.vo;

import lombok.Data;

import java.time.LocalDateTime;
import java.util.List;

/**
 * 邮件模板VO
 *
 * @author tidecanvas
 */
@Data
public class EmailTemplateVO {

    private Long id;

    private String templateCode;

    private String templateName;

    private String subject;

    private String content;

    /** 可用变量(由系统场景定义,编辑器据此提供插入与预览参数填写) */
    private List<VariableVO> variables;

    private Integer enabled;

    private String remark;

    private LocalDateTime updateTime;

    /**
     * 模板变量说明
     */
    @Data
    public static class VariableVO {

        /** 变量名,模板中以 {{name}} 引用 */
        private String name;

        /** 用途说明 */
        private String description;

        /** 预览默认示例值 */
        private String sample;
    }
}
