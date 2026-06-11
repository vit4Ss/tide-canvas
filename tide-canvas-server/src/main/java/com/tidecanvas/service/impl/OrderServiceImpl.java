package com.tidecanvas.service.impl;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.tidecanvas.common.PageResult;
import com.tidecanvas.common.ResultCode;
import com.tidecanvas.enums.OrderStatusEnum;
import com.tidecanvas.enums.PointsTransactionTypeEnum;
import com.tidecanvas.exception.BusinessException;
import com.tidecanvas.mapper.RechargeOrderMapper;
import com.tidecanvas.mapper.SysConfigMapper;
import com.tidecanvas.model.dto.RechargeCreateDTO;
import com.tidecanvas.model.entity.RechargeOrderDO;
import com.tidecanvas.model.entity.SysConfigDO;
import com.tidecanvas.model.query.AdminOrderQuery;
import com.tidecanvas.model.query.OrderQuery;
import com.tidecanvas.model.vo.RechargeOrderVO;
import com.tidecanvas.service.OrderService;
import com.tidecanvas.service.PointsService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.List;
import java.util.concurrent.ThreadLocalRandom;

@Slf4j
@Service
@RequiredArgsConstructor
public class OrderServiceImpl implements OrderService {

    private final RechargeOrderMapper orderMapper;
    private final SysConfigMapper configMapper;
    private final PointsService pointsService;

    private static final String RECHARGE_RATIO_KEY = "points.recharge.ratio";
    private static final int DEFAULT_RECHARGE_RATIO = 100;
    private static final DateTimeFormatter DATE_TIME_FORMATTER = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss");

    @Override
    @Transactional(rollbackFor = Exception.class)
    public RechargeOrderVO createOrder(Long userId, RechargeCreateDTO dto) {
        String orderNo = generateOrderNo();
        int pointsAmount = dto.getAmount()
                .multiply(BigDecimal.valueOf(getRechargeRatio()))
                .setScale(0, RoundingMode.DOWN)
                .intValue();

        RechargeOrderDO order = new RechargeOrderDO();
        order.setOrderNo(orderNo);
        order.setUserId(userId);
        order.setAmount(dto.getAmount());
        order.setPointsAmount(pointsAmount);
        order.setPaymentMethod(dto.getPaymentMethod());
        order.setStatus(OrderStatusEnum.PENDING.getCode());
        order.setDeleted(0);
        orderMapper.insert(order);

        log.info("Recharge order created: orderNo={}, userId={}, amount={}, pointsAmount={}",
                orderNo, userId, dto.getAmount(), pointsAmount);
        return toOrderVO(order);
    }

    @Override
    @Transactional(rollbackFor = Exception.class)
    public void payOrder(Long orderId) {
        if (!doConfirmPaid(orderId, null, "manual")) {
            throw new BusinessException(ResultCode.ORDER_STATUS_ERROR);
        }
    }

    @Override
    @Transactional(rollbackFor = Exception.class)
    public boolean confirmOrderPaid(Long orderId, String paymentNo, String paymentMethod) {
        return doConfirmPaid(orderId, paymentNo, paymentMethod);
    }

    /**
     * 条件更新「待支付→已支付」保证并发/重复调用下只发放一次积分;
     * 私有实现供两个事务入口共享(同类自调用不经代理,事务注解须落在公开入口上)。
     */
    private boolean doConfirmPaid(Long orderId, String paymentNo, String paymentMethod) {
        RechargeOrderDO order = orderMapper.selectById(orderId);
        if (order == null) {
            throw new BusinessException(ResultCode.NOT_FOUND, "订单不存在");
        }

        int updated = orderMapper.markPaidIfPending(
                orderId, OrderStatusEnum.PENDING.getCode(), OrderStatusEnum.PAID.getCode(),
                paymentNo, paymentMethod);
        if (updated == 0) {
            return false;
        }

        pointsService.addPoints(order.getUserId(), order.getPointsAmount(),
                PointsTransactionTypeEnum.RECHARGE, order.getId(), "充值订单: " + order.getOrderNo());

        log.info("Recharge order paid: orderNo={}, userId={}, pointsAmount={}, paymentNo={}",
                order.getOrderNo(), order.getUserId(), order.getPointsAmount(), paymentNo);
        return true;
    }

    @Override
    @Transactional(rollbackFor = Exception.class)
    public void cancelOrder(Long userId, Long orderId) {
        RechargeOrderDO order = orderMapper.selectById(orderId);
        if (order == null) {
            throw new BusinessException(ResultCode.NOT_FOUND, "订单不存在");
        }
        if (!order.getUserId().equals(userId)) {
            throw new BusinessException(ResultCode.FORBIDDEN, "无权操作该订单");
        }

        // 条件更新防并发:避免「取消」与「支付回调」竞态时覆盖已支付状态
        int updated = orderMapper.markCancelledIfPending(
                orderId, OrderStatusEnum.PENDING.getCode(), OrderStatusEnum.CANCELLED.getCode());
        if (updated == 0) {
            throw new BusinessException(ResultCode.ORDER_STATUS_ERROR);
        }
        log.info("Recharge order cancelled: orderNo={}, userId={}", order.getOrderNo(), userId);
    }

    @Override
    public RechargeOrderVO getUserOrder(Long userId, Long orderId) {
        RechargeOrderDO order = orderMapper.selectById(orderId);
        if (order == null) {
            throw new BusinessException(ResultCode.NOT_FOUND, "订单不存在");
        }
        if (!order.getUserId().equals(userId)) {
            throw new BusinessException(ResultCode.FORBIDDEN, "无权查看该订单");
        }
        return toOrderVO(order);
    }

    @Override
    public RechargeOrderVO getOrderById(Long orderId) {
        RechargeOrderDO order = orderMapper.selectById(orderId);
        if (order == null) {
            throw new BusinessException(ResultCode.NOT_FOUND, "订单不存在");
        }
        return toOrderVO(order);
    }

    @Override
    public PageResult<RechargeOrderVO> listOrders(Long userId, OrderQuery query) {
        Page<RechargeOrderDO> page = new Page<>(query.getPageNum(), query.getPageSize());
        LambdaQueryWrapper<RechargeOrderDO> wrapper = new LambdaQueryWrapper<RechargeOrderDO>()
                .eq(RechargeOrderDO::getUserId, userId)
                .eq(query.getStatus() != null, RechargeOrderDO::getStatus, query.getStatus())
                .ge(StringUtils.hasText(query.getStartTime()), RechargeOrderDO::getCreateTime,
                        StringUtils.hasText(query.getStartTime()) ? LocalDateTime.parse(query.getStartTime(), DATE_TIME_FORMATTER) : null)
                .le(StringUtils.hasText(query.getEndTime()), RechargeOrderDO::getCreateTime,
                        StringUtils.hasText(query.getEndTime()) ? LocalDateTime.parse(query.getEndTime(), DATE_TIME_FORMATTER) : null)
                .orderByDesc(RechargeOrderDO::getCreateTime);

        orderMapper.selectPage(page, wrapper);
        List<RechargeOrderVO> records = page.getRecords().stream().map(this::toOrderVO).toList();
        return PageResult.of(records, page);
    }

    @Override
    public PageResult<RechargeOrderVO> listAllOrders(AdminOrderQuery query) {
        Page<RechargeOrderDO> page = new Page<>(query.getPageNum(), query.getPageSize());
        LambdaQueryWrapper<RechargeOrderDO> wrapper = new LambdaQueryWrapper<RechargeOrderDO>()
                .eq(query.getUserId() != null, RechargeOrderDO::getUserId, query.getUserId())
                .eq(query.getStatus() != null, RechargeOrderDO::getStatus, query.getStatus())
                .like(StringUtils.hasText(query.getOrderNo()), RechargeOrderDO::getOrderNo, query.getOrderNo())
                .ge(StringUtils.hasText(query.getStartTime()), RechargeOrderDO::getCreateTime,
                        StringUtils.hasText(query.getStartTime()) ? LocalDateTime.parse(query.getStartTime(), DATE_TIME_FORMATTER) : null)
                .le(StringUtils.hasText(query.getEndTime()), RechargeOrderDO::getCreateTime,
                        StringUtils.hasText(query.getEndTime()) ? LocalDateTime.parse(query.getEndTime(), DATE_TIME_FORMATTER) : null)
                .orderByDesc(RechargeOrderDO::getCreateTime);

        orderMapper.selectPage(page, wrapper);
        List<RechargeOrderVO> records = page.getRecords().stream().map(this::toOrderVO).toList();
        return PageResult.of(records, page);
    }

    private String generateOrderNo() {
        return "TC" + System.currentTimeMillis() + ThreadLocalRandom.current().nextInt(1000, 10000);
    }

    private int getRechargeRatio() {
        SysConfigDO config = configMapper.selectOne(
                new LambdaQueryWrapper<SysConfigDO>().eq(SysConfigDO::getConfigKey, RECHARGE_RATIO_KEY));
        if (config != null && StringUtils.hasText(config.getConfigValue())) {
            try {
                return Integer.parseInt(config.getConfigValue());
            } catch (NumberFormatException e) {
                log.warn("Invalid recharge ratio config, using default {}", DEFAULT_RECHARGE_RATIO);
            }
        }
        return DEFAULT_RECHARGE_RATIO;
    }

    private RechargeOrderVO toOrderVO(RechargeOrderDO order) {
        RechargeOrderVO vo = new RechargeOrderVO();
        vo.setId(order.getId());
        vo.setOrderNo(order.getOrderNo());
        vo.setAmount(order.getAmount());
        vo.setPointsAmount(order.getPointsAmount());
        vo.setPaymentMethod(order.getPaymentMethod());
        vo.setPaymentNo(order.getPaymentNo());
        vo.setStatus(order.getStatus());
        vo.setPaidTime(order.getPaidTime());
        vo.setCreateTime(order.getCreateTime());

        OrderStatusEnum statusEnum = OrderStatusEnum.of(order.getStatus());
        vo.setStatusName(statusEnum != null ? statusEnum.getDesc() : "未知");
        return vo;
    }
}
