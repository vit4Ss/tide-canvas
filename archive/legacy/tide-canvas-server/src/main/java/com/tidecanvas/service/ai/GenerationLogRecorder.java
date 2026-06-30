package com.tidecanvas.service.ai;

import com.tidecanvas.mapper.AiGenerationLogMapper;
import com.tidecanvas.model.entity.AiGenerationLogDO;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;

import java.time.LocalDateTime;

/**
 * AI 生成日志记录器。回填上下文（任务/用户）并落库，best-effort 不影响主流程。
 *
 * @author tidecanvas
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class GenerationLogRecorder {

    private final AiGenerationLogMapper logMapper;

    /** 响应体最大留存长度，避免超大 HTML/JSON 撑爆表 */
    private static final int MAX_BODY = 8000;

    public void save(AiGenerationLogDO lg) {
        try {
            GenerationLogContext.Ctx ctx = GenerationLogContext.get();
            if (ctx != null) {
                lg.setTaskId(ctx.taskId());
                lg.setUserId(ctx.userId());
                lg.setProjectId(ctx.projectId());
                if (!StringUtils.hasText(lg.getHandlerName())) {
                    lg.setHandlerName(ctx.handler());
                }
            }
            lg.setRequestBody(truncate(lg.getRequestBody()));
            lg.setResponseBody(truncate(lg.getResponseBody()));
            lg.setCreateTime(LocalDateTime.now());
            logMapper.insert(lg);
        } catch (Exception e) {
            log.warn("记录AI生成日志失败", e);
        }
    }

    /**
     * 记录一条非 AI 任务的操作日志（文件上传/删除/保存素材等）。
     * <p>
     * 这些操作不在 AI 任务线程上、无 {@link GenerationLogContext}，故直接显式传入 userId/projectId，
     * 不依赖上下文回填；{@code taskId} 留空（无扣分流水 → 后台不显示退积分按钮）。
     *
     * @param operationType 操作大类：file_upload / file_delete / asset_save
     * @param userId        操作用户
     * @param projectId     关联画布（可空）
     * @param operation     操作细分描述（如文件名/动作）
     * @param success       是否成功
     * @param resultUrl     结果地址（文件 URL，可空）
     * @param errorMsg      错误信息（可空）
     */
    public void recordOperation(String operationType, Long userId, Long projectId, String operation,
                                 boolean success, String resultUrl, String errorMsg) {
        try {
            AiGenerationLogDO lg = new AiGenerationLogDO();
            lg.setOperationType(operationType);
            lg.setUserId(userId);
            lg.setProjectId(projectId);
            lg.setOperation(operation);
            lg.setSuccess(success ? 1 : 0);
            lg.setResultUrl(StringUtils.hasText(resultUrl) ? resultUrl : null);
            lg.setErrorMsg(StringUtils.hasText(errorMsg) ? errorMsg : null);
            lg.setCreateTime(LocalDateTime.now());
            logMapper.insert(lg);
        } catch (Exception e) {
            log.warn("记录操作日志失败: operationType={}, userId={}", operationType, userId, e);
        }
    }

    private String truncate(String s) {
        if (s != null && s.length() > MAX_BODY) {
            return s.substring(0, MAX_BODY) + "...[truncated]";
        }
        return s;
    }
}
