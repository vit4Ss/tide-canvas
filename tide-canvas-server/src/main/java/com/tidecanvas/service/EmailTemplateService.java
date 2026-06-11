package com.tidecanvas.service;

import com.tidecanvas.model.dto.EmailTemplatePreviewDTO;
import com.tidecanvas.model.dto.EmailTemplateSendTestDTO;
import com.tidecanvas.model.dto.EmailTemplateUpdateDTO;
import com.tidecanvas.model.vo.EmailRenderVO;
import com.tidecanvas.model.vo.EmailTemplateVO;

import java.util.List;
import java.util.Map;
import java.util.Optional;

/**
 * 邮件模板服务接口
 *
 * @author tidecanvas
 */
public interface EmailTemplateService {

    /**
     * 模板列表(管理端)
     *
     * @return 模板VO列表
     */
    List<EmailTemplateVO> listTemplates();

    /**
     * 模板详情
     *
     * @param id 模板ID
     * @return 模板VO
     */
    EmailTemplateVO getTemplate(Long id);

    /**
     * 更新模板内容(编码与变量定义不可改)
     *
     * @param id  模板ID
     * @param dto 更新DTO
     */
    void updateTemplate(Long id, EmailTemplateUpdateDTO dto);

    /**
     * 预览渲染:对编辑中的主题/正文做变量替换,不落库
     *
     * @param dto 预览DTO
     * @return 渲染结果(含缺失变量提示)
     */
    EmailRenderVO preview(EmailTemplatePreviewDTO dto);

    /**
     * 按模板编码渲染(供业务发信使用);模板不存在或停用时返回空,由调用方回退默认文案
     *
     * @param templateCode 模板编码
     * @param params       变量值
     * @return 渲染结果
     */
    Optional<EmailRenderVO> renderByCode(String templateCode, Map<String, String> params);

    /**
     * 发送测试邮件(使用已保存的模板内容渲染)
     *
     * @param id  模板ID
     * @param dto 测试DTO(收件人与变量测试值)
     */
    void sendTest(Long id, EmailTemplateSendTestDTO dto);
}
