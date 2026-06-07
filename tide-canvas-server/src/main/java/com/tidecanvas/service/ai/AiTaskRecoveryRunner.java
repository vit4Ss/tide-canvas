package com.tidecanvas.service.ai;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.core.conditions.update.LambdaUpdateWrapper;
import com.tidecanvas.enums.AiTaskStatusEnum;
import com.tidecanvas.enums.PointsTransactionTypeEnum;
import com.tidecanvas.mapper.AiTaskMapper;
import com.tidecanvas.mapper.PointsTransactionMapper;
import com.tidecanvas.model.entity.AiTaskDO;
import com.tidecanvas.model.entity.PointsTransactionDO;
import com.tidecanvas.service.PointsService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.time.LocalDateTime;
import java.util.List;

/**
 * AI 任务恢复 / 收尾器。
 * <p>
 * 异步任务（{@link AiTaskRunner}）在内存线程中执行，进程一旦重启线程即丢失，
 * 数据库里仍处于“处理中”的任务将永远无法被推进，前端历史面板会一直显示转圈。
 * 本组件负责两类收尾，并按已扣积分幂等退还：
 * <ul>
 *   <li>启动收尾：进程就绪时，把所有遗留的“处理中”任务判为失败（必为上一进程的孤儿）。</li>
 *   <li>超时收尾：定时扫描，把“处理中”超过阈值的任务判为超时失败（兜底上游卡死 / 线程泄漏）。</li>
 * </ul>
 *
 * @author tidecanvas
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class AiTaskRecoveryRunner {

    /** 处理中任务的最大存活时长（分钟），超过即判为超时失败。gpt-image-2 同步最长约 140s，留足余量。 */
    private static final long TIMEOUT_MINUTES = 15;

    private final AiTaskMapper taskMapper;
    private final PointsTransactionMapper transactionMapper;
    private final PointsService pointsService;

    /**
     * 进程就绪后收尾上一次运行遗留的“处理中”任务。
     * 以“当前时刻”为界：本次启动前创建的处理中任务必是孤儿；启动后新建的任务 createTime 更晚，不受影响。
     */
    @EventListener(ApplicationReadyEvent.class)
    public void recoverOnStartup() {
        int n = failProcessingBefore(LocalDateTime.now(), "服务重启，任务中断");
        if (n > 0) {
            log.warn("启动收尾：{} 个中断的处理中任务已标记为失败并退还积分", n);
        }
    }

    /**
     * 定时收尾长时间未完成的“处理中”任务（兜底上游无响应 / 线程泄漏导致状态永不更新）。
     * 首次延迟 5 分钟执行，避免与启动收尾撞车；之后每 5 分钟扫描一次。
     */
    @Scheduled(fixedDelayString = "${ai.task.timeout-scan-ms:300000}", initialDelay = 300000)
    public void recoverTimedOut() {
        int n = failProcessingBefore(LocalDateTime.now().minusMinutes(TIMEOUT_MINUTES), "任务执行超时");
        if (n > 0) {
            log.warn("超时收尾：{} 个处理中任务超过 {} 分钟未完成，已标记为失败并退还积分", n, TIMEOUT_MINUTES);
        }
    }

    /**
     * 将 createTime 早于 {@code before} 且仍处于“处理中”的任务收尾为失败，并幂等退还积分。
     *
     * @return 实际收尾的任务数
     */
    private int failProcessingBefore(LocalDateTime before, String reason) {
        List<AiTaskDO> tasks = taskMapper.selectList(new LambdaQueryWrapper<AiTaskDO>()
                .eq(AiTaskDO::getStatus, AiTaskStatusEnum.PROCESSING.getCode())
                .lt(AiTaskDO::getCreateTime, before));
        int done = 0;
        for (AiTaskDO t : tasks) {
            // CAS：仅当本次真正把 0(处理中)→2(失败) 转换成功才退款，避免与其它收尾 / 正常完成竞态重复退
            int updated = taskMapper.update(null, new LambdaUpdateWrapper<AiTaskDO>()
                    .eq(AiTaskDO::getId, t.getId())
                    .eq(AiTaskDO::getStatus, AiTaskStatusEnum.PROCESSING.getCode())
                    .set(AiTaskDO::getStatus, AiTaskStatusEnum.FAILED.getCode())
                    .set(AiTaskDO::getErrorMsg, reason)
                    .set(AiTaskDO::getProgress, 100)
                    .set(AiTaskDO::getCompleteTime, LocalDateTime.now()));
            if (updated == 1) {
                refundIfNeeded(t.getId(), t.getUserId());
                done++;
            }
        }
        return done;
    }

    /**
     * 按该任务已扣积分退还，幂等：已存在退还流水则跳过；退还额取该任务全部 AI 消耗流水的绝对值之和。
     */
    private void refundIfNeeded(Long taskId, Long userId) {
        Long refunded = transactionMapper.selectCount(new LambdaQueryWrapper<PointsTransactionDO>()
                .eq(PointsTransactionDO::getBizId, taskId)
                .eq(PointsTransactionDO::getType, PointsTransactionTypeEnum.AI_REFUND.getCode()));
        if (refunded != null && refunded > 0) {
            return; // 已退过
        }
        List<PointsTransactionDO> consumes = transactionMapper.selectList(new LambdaQueryWrapper<PointsTransactionDO>()
                .eq(PointsTransactionDO::getBizId, taskId)
                .eq(PointsTransactionDO::getType, PointsTransactionTypeEnum.AI_CONSUME.getCode()));
        int refund = consumes.stream()
                .mapToInt(c -> c.getAmount() == null ? 0 : Math.abs(c.getAmount()))
                .sum();
        if (refund > 0) {
            try {
                pointsService.addPoints(userId, refund, PointsTransactionTypeEnum.AI_REFUND, taskId, "任务中断返还");
                log.info("任务中断退还积分: userId={}, taskId={}, points={}", userId, taskId, refund);
            } catch (Exception e) {
                log.error("任务中断退还积分失败: taskId={}", taskId, e);
            }
        }
    }
}
