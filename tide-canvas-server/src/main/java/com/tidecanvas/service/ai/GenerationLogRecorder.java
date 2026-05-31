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

    private String truncate(String s) {
        if (s != null && s.length() > MAX_BODY) {
            return s.substring(0, MAX_BODY) + "...[truncated]";
        }
        return s;
    }
}
