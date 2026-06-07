package com.tidecanvas.model.query;

import lombok.Data;
import lombok.EqualsAndHashCode;

/**
 * AI 生成日志查询。
 *
 * @author tidecanvas
 */
@Data
@EqualsAndHashCode(callSuper = true)
public class AiGenerationLogQuery extends PageQuery {
    private Long taskId;
    private Long userId;
    private Long projectId;
    private String handlerName;
    /** 操作大类：ai_generate / file_upload / file_delete / asset_save */
    private String operationType;
    /** 0 失败 / 1 成功 */
    private Integer success;
}
