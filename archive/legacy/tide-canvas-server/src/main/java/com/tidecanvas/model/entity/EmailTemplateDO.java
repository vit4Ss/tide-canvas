package com.tidecanvas.model.entity;

import com.baomidou.mybatisplus.annotation.TableName;
import com.tidecanvas.common.BaseEntity;
import lombok.Data;
import lombok.EqualsAndHashCode;

/**
 * 邮件模板DO。模板编码由系统场景内置(如 register_code),管理后台仅可编辑内容,不可增删编码。
 *
 * @author tidecanvas
 */
@Data
@EqualsAndHashCode(callSuper = true)
@TableName("email_template")
public class EmailTemplateDO extends BaseEntity {

    /** 模板编码(系统内置,唯一) */
    private String templateCode;

    /** 模板名称 */
    private String templateName;

    /** 邮件主题(支持 {{变量}}) */
    private String subject;

    /** 邮件正文HTML(支持 {{变量}}) */
    private String content;

    /** 可用变量说明JSON: [{"name":"code","description":"验证码","sample":"123456"}] */
    private String variables;

    /** 是否启用(0:停用,停用时发送方回退内置默认文案) */
    private Integer enabled;

    /** 备注 */
    private String remark;
}
