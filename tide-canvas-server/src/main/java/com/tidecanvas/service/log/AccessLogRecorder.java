package com.tidecanvas.service.log;

import com.tidecanvas.mapper.AccessLogMapper;
import com.tidecanvas.model.entity.AccessLogDO;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;

/**
 * 访问日志异步落库,避免每次请求阻塞主流程。
 *
 * @author tidecanvas
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class AccessLogRecorder {

    private final AccessLogMapper accessLogMapper;

    @Async
    public void save(AccessLogDO accessLog) {
        try {
            accessLogMapper.insert(accessLog);
        } catch (Exception e) {
            log.warn("记录访问日志失败: {}", e.getMessage());
        }
    }
}
