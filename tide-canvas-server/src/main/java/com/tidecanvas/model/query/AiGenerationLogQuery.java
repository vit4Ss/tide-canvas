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
    /** 0 失败 / 1 成功 */
    private Integer success;
}
