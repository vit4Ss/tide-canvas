package com.tidecanvas.service.ai;

/**
 * 生成日志上下文（ThreadLocal）。
 * <p>
 * {@code AiTaskRunner} / 同步执行处在调用 handler 前设置任务/用户信息，
 * 底层 {@code AiRelayClient} 记录上游调用日志时据此回填归属，避免改动各层方法签名。
 *
 * @author tidecanvas
 */
public final class GenerationLogContext {

    public record Ctx(Long taskId, Long userId, Long projectId, String handler) {
    }

    private static final ThreadLocal<Ctx> HOLDER = new ThreadLocal<>();
    // 本次执行是否已产生过上游调用日志（recordLog 时置位）；任务结束时据此判断要不要补记任务级日志
    private static final ThreadLocal<Boolean> RECORDED = new ThreadLocal<>();

    private GenerationLogContext() {
    }

    public static void set(Long taskId, Long userId, Long projectId, String handler) {
        HOLDER.set(new Ctx(taskId, userId, projectId, handler));
    }

    public static Ctx get() {
        return HOLDER.get();
    }

    public static void markRecorded() {
        RECORDED.set(Boolean.TRUE);
    }

    public static boolean isRecorded() {
        return Boolean.TRUE.equals(RECORDED.get());
    }

    public static void clear() {
        HOLDER.remove();
        RECORDED.remove();
    }
}
