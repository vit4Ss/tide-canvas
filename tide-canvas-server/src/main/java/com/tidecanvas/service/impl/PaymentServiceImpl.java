package com.tidecanvas.service.impl;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.tidecanvas.common.ResultCode;
import com.tidecanvas.enums.OrderStatusEnum;
import com.tidecanvas.exception.BusinessException;
import com.tidecanvas.mapper.RechargeOrderMapper;
import com.tidecanvas.mapper.SysConfigMapper;
import com.tidecanvas.model.entity.RechargeOrderDO;
import com.tidecanvas.model.entity.SysConfigDO;
import com.tidecanvas.model.vo.PaymentInitiateVO;
import com.tidecanvas.model.vo.RechargeConfigVO;
import com.tidecanvas.model.vo.RechargeOrderVO;
import com.tidecanvas.service.OrderService;
import com.tidecanvas.service.PaymentService;
import com.tidecanvas.service.pay.EpayClient;
import com.tidecanvas.service.pay.EpayConfig;
import com.tidecanvas.util.EpaySignUtil;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;

import java.math.BigDecimal;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

/**
 * 支付服务实现:基于易支付 V2 协议(配置存于 sys_config,管理后台可维护)。
 * <p>
 * 注意:本类方法不加事务 —— 网关 HTTP 调用不应占用数据库事务,
 * 落库动作统一走 {@link OrderService#confirmOrderPaid}(自带事务与幂等)。
 *
 * @author tidecanvas
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class PaymentServiceImpl implements PaymentService {

    private static final String KEY_ENABLED = "pay.epay.enabled";
    private static final String KEY_GATEWAY = "pay.epay.gateway";
    private static final String KEY_PID = "pay.epay.pid";
    private static final String KEY_MERCHANT_PRIVATE_KEY = "pay.epay.merchant_private_key";
    private static final String KEY_PLATFORM_PUBLIC_KEY = "pay.epay.platform_public_key";
    private static final String KEY_NOTIFY_URL = "pay.epay.notify_url";
    private static final String KEY_RETURN_URL = "pay.epay.return_url";
    private static final String KEY_PAY_TYPES = "pay.epay.pay_types";
    private static final String KEY_RECHARGE_RATIO = "points.recharge.ratio";

    private static final List<String> CONFIG_KEYS = List.of(
            KEY_ENABLED, KEY_GATEWAY, KEY_PID, KEY_MERCHANT_PRIVATE_KEY,
            KEY_PLATFORM_PUBLIC_KEY, KEY_NOTIFY_URL, KEY_RETURN_URL, KEY_PAY_TYPES,
            KEY_RECHARGE_RATIO);

    private static final int DEFAULT_RECHARGE_RATIO = 100;
    private static final String TRADE_SUCCESS = "TRADE_SUCCESS";
    private static final String NOTIFY_SUCCESS = "success";
    private static final String NOTIFY_FAIL = "fail";
    /** 通知时间戳允许的最大偏差(秒),防重放;幂等已兜底,故放宽到 15 分钟 */
    private static final long NOTIFY_TIMESTAMP_TOLERANCE_SECONDS = 900;

    private final SysConfigMapper configMapper;
    private final RechargeOrderMapper orderMapper;
    private final OrderService orderService;
    private final EpayClient epayClient;

    @Override
    public RechargeConfigVO getRechargeConfig() {
        Map<String, String> configs = loadConfigMap();
        EpayConfig epay = toEpayConfig(configs);

        RechargeConfigVO vo = new RechargeConfigVO();
        vo.setRatio(parseRatio(configs.get(KEY_RECHARGE_RATIO)));
        vo.setOnlinePayEnabled(epay.isEnabled() && epay.isComplete());
        vo.setPayTypes(epay.getPayTypes());
        return vo;
    }

    @Override
    public PaymentInitiateVO initiatePay(Long userId, Long orderId, String payType) {
        EpayConfig config = toEpayConfig(loadConfigMap());
        if (!config.isEnabled()) {
            throw new BusinessException(ResultCode.PAYMENT_DISABLED);
        }
        if (!config.isComplete()) {
            throw new BusinessException(ResultCode.PAYMENT_CONFIG_ERROR);
        }

        RechargeOrderDO order = orderMapper.selectById(orderId);
        if (order == null) {
            throw new BusinessException(ResultCode.NOT_FOUND, "订单不存在");
        }
        if (!order.getUserId().equals(userId)) {
            throw new BusinessException(ResultCode.FORBIDDEN, "无权操作该订单");
        }
        if (order.getStatus() != OrderStatusEnum.PENDING.getCode()) {
            throw new BusinessException(ResultCode.ORDER_STATUS_ERROR);
        }

        String resolvedType = StringUtils.hasText(payType) ? payType : order.getPaymentMethod();
        if (StringUtils.hasText(resolvedType) && !config.getPayTypes().isEmpty()
                && !config.getPayTypes().contains(resolvedType)) {
            // 不在启用列表内则交给网关收银台,避免直接报错挡住老订单
            resolvedType = null;
        }
        if (StringUtils.hasText(resolvedType) && !resolvedType.equals(order.getPaymentMethod())) {
            RechargeOrderDO update = new RechargeOrderDO();
            update.setId(order.getId());
            update.setPaymentMethod(resolvedType);
            orderMapper.updateById(update);
        }

        String productName = "积分充值" + order.getPointsAmount() + "分";
        Map<String, String> params;
        try {
            params = epayClient.buildSubmitParams(
                    config, order.getOrderNo(), order.getAmount(), productName, resolvedType);
        } catch (IllegalStateException e) {
            // 私钥格式/内容错误属于配置问题,转为明确的业务提示而非 500
            log.error("Epay sign failed, check merchant private key: {}", e.getMessage());
            throw new BusinessException(ResultCode.PAYMENT_CONFIG_ERROR);
        }

        PaymentInitiateVO vo = new PaymentInitiateVO();
        vo.setPayUrl(epayClient.submitUrl(config));
        vo.setParams(params);
        vo.setOrderNo(order.getOrderNo());
        log.info("Payment initiated: orderNo={}, userId={}, type={}", order.getOrderNo(), userId, resolvedType);
        return vo;
    }

    @Override
    public String handleNotify(Map<String, String> params) {
        try {
            EpayConfig config = toEpayConfig(loadConfigMap());
            if (!config.isComplete()) {
                log.warn("Epay notify received but config incomplete");
                return NOTIFY_FAIL;
            }

            String sign = params.get("sign");
            String content = EpaySignUtil.buildSignContent(params);
            if (!EpaySignUtil.verify(content, sign, config.getPlatformPublicKey())) {
                log.warn("Epay notify sign verify failed: outTradeNo={}", params.get("out_trade_no"));
                return NOTIFY_FAIL;
            }
            if (!config.getPid().equals(params.get("pid"))) {
                log.warn("Epay notify pid mismatch: got={}", params.get("pid"));
                return NOTIFY_FAIL;
            }
            if (!isTimestampValid(params.get("timestamp"))) {
                log.warn("Epay notify timestamp out of range: ts={}, outTradeNo={}",
                        params.get("timestamp"), params.get("out_trade_no"));
                return NOTIFY_FAIL;
            }
            if (!TRADE_SUCCESS.equals(params.get("trade_status"))) {
                // 非成功状态确认收到即可,避免网关对无需处理的通知反复重试
                return NOTIFY_SUCCESS;
            }

            String outTradeNo = params.get("out_trade_no");
            RechargeOrderDO order = orderMapper.selectOne(
                    new LambdaQueryWrapper<RechargeOrderDO>().eq(RechargeOrderDO::getOrderNo, outTradeNo));
            if (order == null) {
                log.warn("Epay notify for unknown order: outTradeNo={}", outTradeNo);
                return NOTIFY_FAIL;
            }
            BigDecimal notifyMoney;
            try {
                notifyMoney = new BigDecimal(params.get("money"));
            } catch (Exception e) {
                log.warn("Epay notify invalid money: {}", params.get("money"));
                return NOTIFY_FAIL;
            }
            if (order.getAmount().compareTo(notifyMoney) != 0) {
                log.error("Epay notify money mismatch: orderNo={}, expect={}, got={}",
                        outTradeNo, order.getAmount(), notifyMoney);
                return NOTIFY_FAIL;
            }

            boolean confirmed = orderService.confirmOrderPaid(
                    order.getId(), params.get("trade_no"), params.get("type"));
            if (confirmed) {
                return NOTIFY_SUCCESS;
            }
            // 未发生变更:已支付的重复通知按成功应答;已取消等异常状态留给网关重试并告警
            RechargeOrderDO latest = orderMapper.selectById(order.getId());
            boolean alreadyPaid = latest != null && latest.getStatus() == OrderStatusEnum.PAID.getCode();
            if (!alreadyPaid) {
                log.error("Epay notify on non-pending order: orderNo={}, status={}",
                        outTradeNo, latest != null ? latest.getStatus() : null);
            }
            return alreadyPaid ? NOTIFY_SUCCESS : NOTIFY_FAIL;
        } catch (Exception e) {
            log.error("Epay notify handle error", e);
            return NOTIFY_FAIL;
        }
    }

    @Override
    public RechargeOrderVO syncOrderStatus(Long userId, Long orderId) {
        RechargeOrderDO order = orderMapper.selectById(orderId);
        if (order == null) {
            throw new BusinessException(ResultCode.NOT_FOUND, "订单不存在");
        }
        if (!order.getUserId().equals(userId)) {
            throw new BusinessException(ResultCode.FORBIDDEN, "无权操作该订单");
        }
        if (order.getStatus() != OrderStatusEnum.PENDING.getCode()) {
            return orderService.getUserOrder(userId, orderId);
        }

        EpayConfig config = toEpayConfig(loadConfigMap());
        if (!config.isComplete()) {
            throw new BusinessException(ResultCode.PAYMENT_CONFIG_ERROR);
        }
        EpayClient.EpayOrderStatus status = epayClient.queryOrder(config, order.getOrderNo());
        if (status.isPaid()) {
            orderService.confirmOrderPaid(order.getId(), status.tradeNo(), null);
            log.info("Order synced as paid via query: orderNo={}", order.getOrderNo());
        }
        return orderService.getUserOrder(userId, orderId);
    }

    private Map<String, String> loadConfigMap() {
        List<SysConfigDO> configs = configMapper.selectList(
                new LambdaQueryWrapper<SysConfigDO>().in(SysConfigDO::getConfigKey, CONFIG_KEYS));
        return configs.stream()
                .filter(c -> c.getConfigValue() != null)
                .collect(Collectors.toMap(SysConfigDO::getConfigKey, SysConfigDO::getConfigValue, (a, b) -> a));
    }

    private EpayConfig toEpayConfig(Map<String, String> configs) {
        EpayConfig config = new EpayConfig();
        config.setEnabled(Boolean.parseBoolean(configs.getOrDefault(KEY_ENABLED, "false").trim()));
        config.setGateway(trimToNull(configs.get(KEY_GATEWAY)));
        config.setPid(trimToNull(configs.get(KEY_PID)));
        config.setMerchantPrivateKey(trimToNull(configs.get(KEY_MERCHANT_PRIVATE_KEY)));
        config.setPlatformPublicKey(trimToNull(configs.get(KEY_PLATFORM_PUBLIC_KEY)));
        config.setNotifyUrl(trimToNull(configs.get(KEY_NOTIFY_URL)));
        config.setReturnUrl(trimToNull(configs.get(KEY_RETURN_URL)));
        String payTypes = configs.getOrDefault(KEY_PAY_TYPES, "");
        config.setPayTypes(Arrays.stream(payTypes.split(","))
                .map(String::trim)
                .filter(StringUtils::hasText)
                .collect(Collectors.toList()));
        return config;
    }

    private int parseRatio(String value) {
        if (StringUtils.hasText(value)) {
            try {
                return Integer.parseInt(value.trim());
            } catch (NumberFormatException e) {
                log.warn("Invalid recharge ratio config: {}", value);
            }
        }
        return DEFAULT_RECHARGE_RATIO;
    }

    private boolean isTimestampValid(String timestamp) {
        if (!StringUtils.hasText(timestamp)) {
            return false;
        }
        try {
            long ts = Long.parseLong(timestamp.trim());
            return Math.abs(System.currentTimeMillis() / 1000 - ts) <= NOTIFY_TIMESTAMP_TOLERANCE_SECONDS;
        } catch (NumberFormatException e) {
            return false;
        }
    }

    private String trimToNull(String value) {
        if (value == null) {
            return null;
        }
        String trimmed = value.trim();
        return trimmed.isEmpty() ? null : trimmed;
    }
}
