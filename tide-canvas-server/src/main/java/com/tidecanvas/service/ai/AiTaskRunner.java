package com.tidecanvas.service.ai;

import com.tidecanvas.enums.AiTaskStatusEnum;
import com.tidecanvas.enums.PointsTransactionTypeEnum;
import com.tidecanvas.mapper.AiGenerationLogMapper;
import com.tidecanvas.mapper.AiTaskMapper;
import com.tidecanvas.model.entity.AiGenerationLogDO;
import com.tidecanvas.model.entity.AiTaskDO;
import com.tidecanvas.service.PointsService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;

import java.time.LocalDateTime;
import java.util.Map;

/**
 * AI 任务异步执行器。
 * <p>
 * 必须作为独立 Bean：{@code @Async} 只在通过 Spring 代理调用时生效，
 * 若在 {@code AiServiceImpl} 内部自调用（this.xxx）会退化为同步执行。
 *
 * @author tidecanvas
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class AiTaskRunner {

    private final AiTaskMapper taskMapper;
    private final AiGenerationLogMapper logMapper;
    private final PointsService pointsService;

    @Async("aiTaskExecutor")
    public void run(Long taskId, AiHandler handler, String modelId, Map<String, Object> input, int pointCost) {
        AiTaskDO task = taskMapper.selectById(taskId);
        if (task == null) {
            log.error("AI任务不存在: taskId={}", taskId);
            return;
        }
        GenerationLogContext.set(taskId, task.getUserId(), task.getProjectId(), task.getHandlerName());
        long startMs = System.currentTimeMillis();
        boolean failed = false;
        String resultUrl = null;
        String errorMsg = null;
        try {
            AiHandlerResult result = handler.execute(modelId, input);
            failed = !result.isSuccess();
            resultUrl = result.getResultUrl();
            errorMsg = result.getErrorMsg();
            task.setStatus(result.isSuccess() ? AiTaskStatusEnum.SUCCESS.getCode() : AiTaskStatusEnum.FAILED.getCode());
            task.setResultUrl(resultUrl);
            task.setResultMeta(result.getResultMeta());
            task.setErrorMsg(errorMsg);
            task.setProgress(100);
            task.setCompleteTime(LocalDateTime.now());
        } catch (Exception e) {
            log.error("AI任务执行失败: taskId={}", taskId, e);
            failed = true;
            errorMsg = e.getMessage();
            task.setStatus(AiTaskStatusEnum.FAILED.getCode());
            task.setErrorMsg(errorMsg);
            task.setCompleteTime(LocalDateTime.now());
        } finally {
            // 兜底记录生成日志：仅当本次未产生上游调用日志（占位/调用前异常等）时补记，避免与 recordLog 的详细日志重复
            if (!GenerationLogContext.isRecorded()) {
                recordSummaryLog(task, input, !failed, resultUrl, errorMsg, startMs);
            }
            GenerationLogContext.clear();
        }
        taskMapper.updateById(task);
        if (failed && pointCost > 0) {
            try {
                pointsService.addPoints(task.getUserId(), pointCost, PointsTransactionTypeEnum.AI_REFUND,
                        taskId, "AI生成失败返还");
                log.info("AI生成失败已返还积分: userId={}, taskId={}, points={}", task.getUserId(), taskId, pointCost);
            } catch (Exception e) {
                log.error("返还积分失败: taskId={}", taskId, e);
            }
        }
    }

    /**
     * 记录一条兜底日志（best-effort，重复插入不影响排查）。
     * 如果 handler 内部已经通过 AiRelayClient.recordLog 记录了详细 HTTP 日志，会存在两条记录：
     * 一条含详细请求/响应，一条为摘要 — 管理后台都能查到。
     */
    private void recordSummaryLog(AiTaskDO task, Map<String, Object> input, boolean success,
                                   String resultUrl, String errorMsg, long startMs) {
        try {
            AiGenerationLogDO lg = new AiGenerationLogDO();
            lg.setTaskId(task.getId());
            lg.setUserId(task.getUserId());
            lg.setProjectId(task.getProjectId());
            lg.setHandlerName(task.getHandlerName());
            lg.setOperationType("ai_generate");
            lg.setSuccess(success ? 1 : 0);
            lg.setResultUrl(StringUtils.hasText(resultUrl) ? resultUrl : null);
            lg.setErrorMsg(StringUtils.hasText(errorMsg) ? errorMsg : null);
            lg.setDurationMs(System.currentTimeMillis() - startMs);
            lg.setCreateTime(LocalDateTime.now());
            logMapper.insert(lg);
        } catch (Exception e) {
            log.warn("记录兜底生成日志失败: taskId={}", task.getId(), e);
        }
    }
}
