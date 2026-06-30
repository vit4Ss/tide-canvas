package com.tidecanvas.task;

import com.tidecanvas.mapper.AccessLogMapper;
import com.tidecanvas.mapper.LoginLogMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.time.LocalDateTime;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;

/**
 * 日志清理定时任务：定期删除过期的访问日志/登录日志，避免无限增长。
 *
 * @author tidecanvas
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class LogCleanupTask {

    private static final ZoneId BEIJING_ZONE = ZoneId.of("Asia/Shanghai");
    private static final DateTimeFormatter FMT = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss");
    /** 访问日志保留天数(请求级明细,量大,保留较短) */
    private static final int ACCESS_LOG_KEEP_DAYS = 30;
    /** 登录日志保留天数 */
    private static final int LOGIN_LOG_KEEP_DAYS = 90;

    private final AccessLogMapper accessLogMapper;
    private final LoginLogMapper loginLogMapper;

    /** 每天 03:30 清理过期日志 */
    @Scheduled(cron = "0 30 3 * * ?")
    public void cleanup() {
        try {
            String accessBefore = LocalDateTime.now(BEIJING_ZONE).minusDays(ACCESS_LOG_KEEP_DAYS).format(FMT);
            int access = accessLogMapper.deleteBefore(accessBefore);
            String loginBefore = LocalDateTime.now(BEIJING_ZONE).minusDays(LOGIN_LOG_KEEP_DAYS).format(FMT);
            int login = loginLogMapper.deleteBefore(loginBefore);
            log.info("日志清理完成: 访问日志删除 {} 条(早于 {}), 登录日志删除 {} 条(早于 {})", access, accessBefore, login, loginBefore);
        } catch (Exception e) {
            log.warn("定时清理日志失败", e);
        }
    }
}
