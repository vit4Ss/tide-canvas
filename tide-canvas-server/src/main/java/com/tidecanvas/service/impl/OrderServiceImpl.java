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

/**
 * 订单服务实现类
 *
 * @author tidecanvas
 */
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
        // 生成订单号
        String orderNo = generateOrderNo();

        // 获取充值比例
        int rechargeRatio = getRechargeRatio();

        // 计算积分数量
        int pointsAmount = dto.getAmount()
                .multiply(BigDecimal.valueOf(rechargeRatio))
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

        log.info("充值订单创建成功: orderNo={}, userId={}, amount={}, pointsAmount={}",
                orderNo, userId, dto.getAmount(), pointsAmount);
        return toOrderVO(order);
    }

    @Override
    @Transactional(rollbackFor = Exception.class)
    public void payOrder(Long orderId) {
        RechargeOrderDO order = orderMapper.selectById(orderId);
        if (order == null) {
            throw new BusinessException(ResultCode.NOT_FOUND, "订单不存在");
        }
        if (order.getStatus() != OrderStatusEnum.PENDING.getCode()) {
            throw new BusinessException(ResultCode.ORDER_STATUS_ERROR);
        }

        // 更新订单状态为已支付
        order.setStatus(OrderStatusEnum.PAID.getCode());
        order.setPaidTime(LocalDateTime.now());
        orderMapper.updateById(order);

        // 增加用户积分
        pointsService.addPoints(order.getUserId(), order.getPointsAmount(),
                PointsTransactionTypeEnum.RECHARGE, order.getId(), "充值订单: " + order.getOrderNo());

        log.info("充值订单支付成功: orderNo={}, userId={}, pointsAmount={}",
                order.getOrderNo(), order.getUserId(), order.getPointsAmount());
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
        if (order.getStatus() != OrderStatusEnum.PENDING.getCode()) {
            throw new BusinessException(ResultCode.ORDER_STATUS_ERROR);
        }

        order.setStatus(OrderStatusEnum.CANCELLED.getCode());
        orderMapper.updateById(order);

        log.info("充值订单已取消: orderNo={}, userId={}", order.getOrderNo(), userId);
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

    // ============================= 私有方法 =============================

    /**
     * 生成订单号: TC + 时间戳 + 4位随机数
     */
    private String generateOrderNo() {
        int randomNum = ThreadLocalRandom.current().nextInt(1000, 10000);
        return "TC" + System.currentTimeMillis() + randomNum;
    }

    /**
     * 从系统配置获取充值比例
     */
    private int getRechargeRatio() {
        SysConfigDO config = configMapper.selectOne(
                new LambdaQueryWrapper<SysConfigDO>()
                        .eq(SysConfigDO::getConfigKey, RECHARGE_RATIO_KEY));
        if (config != null && StringUtils.hasText(config.getConfigValue())) {
            try {
                return Integer.parseInt(config.getConfigValue());
            } catch (NumberFormatException e) {
                log.warn("充值比例配置格式异常, 使用默认值: {}", DEFAULT_RECHARGE_RATIO);
            }
        }
        return DEFAULT_RECHARGE_RATIO;
    }

    /**
     * 将订单DO转换为VO
     */
    private RechargeOrderVO toOrderVO(RechargeOrderDO order) {
        RechargeOrderVO vo = new RechargeOrderVO();
        vo.setId(order.getId());
        vo.setOrderNo(order.getOrderNo());
        vo.setAmount(order.getAmount());
        vo.setPointsAmount(order.getPointsAmount());
        vo.setPaymentMethod(order.getPaymentMethod());
        vo.setStatus(order.getStatus());
        vo.setPaidTime(order.getPaidTime());
        vo.setCreateTime(order.getCreateTime());

        OrderStatusEnum statusEnum = OrderStatusEnum.of(order.getStatus());
        vo.setStatusName(statusEnum != null ? statusEnum.getDesc() : "未知");
        return vo;
    }
}
