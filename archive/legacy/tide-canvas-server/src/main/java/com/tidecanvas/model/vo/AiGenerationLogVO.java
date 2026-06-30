package com.tidecanvas.model.vo;

import lombok.Data;

import java.math.BigDecimal;
import java.time.LocalDateTime;

/**
 * AI 生成日志 VO。
 *
 * @author tidecanvas
 */
@Data
public class AiGenerationLogVO {
    private Long id;
    private Long taskId;
    private Long userId;
    private Long projectId;
    private String handlerName;
    private String operationType;
    private String model;
    private String operation;
    private String requestUrl;
    /** 上游请求体：后端实际发送给供应商/中转站的 payload */
    private String requestBody;
    /** 用户输入参数：前端发给后端的原始参数(取自 ai_task.input_params,仅详情接口回填) */
    private String inputParams;
    private Integer httpStatus;
    private String responseBody;
    private String upstreamTaskId;
    private Integer success;
    private String resultUrl;
    private String errorMsg;
    private Long durationMs;
    /** 上游成本（USD）；中转站无此字段时为空 */
    private BigDecimal cost;
    private LocalDateTime createTime;

    // 关联展示字段（后端按 id 回填，非日志表本身列）
    private String userName;
    private String projectName;
    private Integer taskStatus;
}
