package com.tidecanvas.task;

import com.tidecanvas.enums.OrderStatusEnum;
import com.tidecanvas.mapper.RechargeOrderMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.time.LocalDateTime;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;

/**
 * 订单超时任务：把超过 15 分钟仍未支付的充值订单标记为「已超时」。
 *
 * @author tidecanvas
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class OrderTimeoutTask {

    private static final ZoneId BEIJING_ZONE = ZoneId.of("Asia/Shanghai");
    private static final DateTimeFormatter FMT = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss");
    /** 支付超时分钟数 */
    private static final int TIMEOUT_MINUTES = 15;

    private final RechargeOrderMapper orderMapper;

    /** 每分钟扫描一次，关闭超时未支付订单 */
    @Scheduled(cron = "0 * * * * ?")
    public void closeTimeoutOrders() {
        try {
            String cutoff = LocalDateTime.now(BEIJING_ZONE).minusMinutes(TIMEOUT_MINUTES).format(FMT);
            int closed = orderMapper.markTimeoutBeforeCutoff(
                    OrderStatusEnum.PENDING.getCode(), OrderStatusEnum.TIMEOUT.getCode(), cutoff);
            if (closed > 0) {
                log.info("订单超时关闭: {} 笔(创建早于 {})", closed, cutoff);
            }
        } catch (Exception e) {
            log.warn("订单超时任务执行失败", e);
        }
    }
}
