package com.tidecanvas.service;

import com.tidecanvas.common.PageResult;
import com.tidecanvas.model.dto.RechargeCreateDTO;
import com.tidecanvas.model.query.AdminOrderQuery;
import com.tidecanvas.model.query.OrderQuery;
import com.tidecanvas.model.vo.RechargeOrderVO;

/**
 * 订单服务接口
 *
 * @author tidecanvas
 */
public interface OrderService {

    /**
     * 创建充值订单
     *
     * @param userId 用户ID
     * @param dto    充值创建DTO
     * @return 订单VO
     */
    RechargeOrderVO createOrder(Long userId, RechargeCreateDTO dto);

    /**
     * 支付订单（管理端手动标记，订单非待支付时抛出异常）
     *
     * @param orderId 订单ID
     */
    void payOrder(Long orderId);

    /**
     * 幂等确认订单已支付：仅当订单处于待支付时标记已支付并发放积分。
     * 用于支付回调/查单补偿，重复调用安全。
     *
     * @param orderId       订单ID
     * @param paymentNo     第三方支付流水号（可空）
     * @param paymentMethod 实际支付方式（可空，空则保留原值）
     * @return true=本次完成支付确认；false=订单已不在待支付状态（未做任何变更）
     */
    boolean confirmOrderPaid(Long orderId, String paymentNo, String paymentMethod);

    /**
     * 取消订单
     *
     * @param userId  用户ID
     * @param orderId 订单ID
     */
    void cancelOrder(Long userId, Long orderId);

    /**
     * 获取用户订单详情（校验所属权）
     *
     * @param userId  用户ID
     * @param orderId 订单ID
     * @return 订单VO
     */
    RechargeOrderVO getUserOrder(Long userId, Long orderId);

    /**
     * 获取订单详情（管理端，不校验所属权）
     *
     * @param orderId 订单ID
     * @return 订单VO
     */
    RechargeOrderVO getOrderById(Long orderId);

    /**
     * 分页查询用户订单列表
     *
     * @param userId 用户ID
     * @param query  查询条件
     * @return 分页结果
     */
    PageResult<RechargeOrderVO> listOrders(Long userId, OrderQuery query);

    /**
     * 分页查询所有订单列表（管理端）
     *
     * @param query 查询条件
     * @return 分页结果
     */
    PageResult<RechargeOrderVO> listAllOrders(AdminOrderQuery query);
}
