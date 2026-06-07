package com.tidecanvas.model.vo;

import lombok.Data;

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
    private String requestBody;
    private Integer httpStatus;
    private String responseBody;
    private String upstreamTaskId;
    private Integer success;
    private String resultUrl;
    private String errorMsg;
    private Long durationMs;
    private LocalDateTime createTime;

    // 关联展示字段（后端按 id 回填，非日志表本身列）
    private String userName;
    private String projectName;
    private Integer taskStatus;
}
