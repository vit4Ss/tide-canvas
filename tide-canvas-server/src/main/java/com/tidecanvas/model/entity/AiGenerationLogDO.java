package com.tidecanvas.model.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Data;

import java.time.LocalDateTime;

/**
 * AI 生成日志：记录每次对上游中转站的调用（请求体、响应、状态、耗时、成败），用于排查生成失败。
 *
 * @author tidecanvas
 */
@Data
@TableName("ai_generation_log")
public class AiGenerationLogDO {

    @TableId(type = IdType.ASSIGN_ID)
    private Long id;

    /** 关联 ai_task 任务 ID */
    private Long taskId;

    private Long userId;

    /** 画布项目 ID */
    private Long projectId;

    private String handlerName;

    /** 操作大类：ai_generate / file_upload / file_delete / asset_save */
    private String operationType;

    /** 上游模型 */
    private String model;

    /** 操作：generation / edits / video */
    private String operation;

    /** 上游请求地址 */
    private String requestUrl;

    /** 上游请求体（JSON） */
    private String requestBody;

    /** 上游 HTTP 状态码 */
    private Integer httpStatus;

    /** 上游响应体（截断） */
    private String responseBody;

    /** 上游任务 ID（异步时） */
    private String upstreamTaskId;

    /** 是否成功（0 失败 / 1 成功） */
    private Integer success;

    /** 结果地址 */
    private String resultUrl;

    /** 错误信息 */
    private String errorMsg;

    /** 耗时（毫秒） */
    private Long durationMs;

    private LocalDateTime createTime;
}
