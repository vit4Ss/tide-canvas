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
            log.error("AI task not found: taskId={}", taskId);
            return;
        }
        if (task.getStatus() == AiTaskStatusEnum.CANCELLED.getCode()) {
            log.info("AI task already cancelled before execution: taskId={}", taskId);
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
            log.error("AI task execution failed: taskId={}", taskId, e);
            failed = true;
            errorMsg = e.getMessage();
            task.setStatus(AiTaskStatusEnum.FAILED.getCode());
            task.setErrorMsg(errorMsg);
            task.setCompleteTime(LocalDateTime.now());
        } finally {
            if (!GenerationLogContext.isRecorded()) {
                recordSummaryLog(task, !failed, resultUrl, errorMsg, startMs);
            }
            GenerationLogContext.clear();
        }

        AiTaskDO latest = taskMapper.selectById(taskId);
        if (latest != null && latest.getStatus() == AiTaskStatusEnum.CANCELLED.getCode()) {
            log.info("AI task completed after cancellation, preserving cancelled status: taskId={}", taskId);
            return;
        }

        taskMapper.updateById(task);
        if (failed && pointCost > 0) {
            try {
                pointsService.addPoints(task.getUserId(), pointCost, PointsTransactionTypeEnum.AI_REFUND,
                        taskId, "AI生成失败返还");
                log.info("AI points refunded: userId={}, taskId={}, points={}", task.getUserId(), taskId, pointCost);
            } catch (Exception e) {
                log.error("Failed to refund AI points: taskId={}", taskId, e);
            }
        }
    }

    private void recordSummaryLog(AiTaskDO task, boolean success,
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
            log.warn("Failed to record fallback AI log: taskId={}", task.getId(), e);
        }
    }
}
