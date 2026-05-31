package com.tidecanvas.service.ai;

import com.tidecanvas.enums.AiTaskStatusEnum;
import com.tidecanvas.enums.PointsTransactionTypeEnum;
import com.tidecanvas.mapper.AiTaskMapper;
import com.tidecanvas.model.entity.AiTaskDO;
import com.tidecanvas.service.PointsService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Component;

import java.time.LocalDateTime;
import java.util.Map;

/**
 * AI 任务异步执行器。
 * <p>
 * 必须作为独立 Bean：{@code @Async} 只在通过 Spring 代理调用时生效，
 * 若在 {@code AiServiceImpl} 内部自调用（this.xxx）会退化为同步执行，
 * 导致 /api/ai/generate 请求阻塞数十秒、前端超时报“生成失败”，而后端其实已成功。
 *
 * @author tidecanvas
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class AiTaskRunner {

    private final AiTaskMapper taskMapper;
    private final PointsService pointsService;

    @Async("aiTaskExecutor")
    public void run(Long taskId, AiHandler handler, String modelId, Map<String, Object> input, int pointCost) {
        AiTaskDO task = taskMapper.selectById(taskId);
        if (task == null) {
            log.error("AI任务不存在: taskId={}", taskId);
            return;
        }
        GenerationLogContext.set(taskId, task.getUserId(), task.getProjectId(), task.getHandlerName());
        boolean failed = false;
        try {
            AiHandlerResult result = handler.execute(modelId, input);
            failed = !result.isSuccess();
            task.setStatus(result.isSuccess() ? AiTaskStatusEnum.SUCCESS.getCode() : AiTaskStatusEnum.FAILED.getCode());
            task.setResultUrl(result.getResultUrl());
            task.setResultMeta(result.getResultMeta());
            task.setErrorMsg(result.getErrorMsg());
            task.setProgress(100);
            task.setCompleteTime(LocalDateTime.now());
        } catch (Exception e) {
            log.error("AI任务执行失败: taskId={}", taskId, e);
            failed = true;
            task.setStatus(AiTaskStatusEnum.FAILED.getCode());
            task.setErrorMsg(e.getMessage());
            task.setCompleteTime(LocalDateTime.now());
        } finally {
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
}
