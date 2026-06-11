package com.tidecanvas.service;

import com.tidecanvas.model.vo.PaymentInitiateVO;
import com.tidecanvas.model.vo.RechargeConfigVO;
import com.tidecanvas.model.vo.RechargeOrderVO;

import java.util.Map;

/**
 * 支付服务接口(易支付网关)
 *
 * @author tidecanvas
 */
public interface PaymentService {

    /**
     * 获取充值配置(充值比例、在线支付开关、可用支付方式)
     *
     * @return 充值配置VO
     */
    RechargeConfigVO getRechargeConfig();

    /**
     * 发起在线支付:校验订单后构建网关跳转参数
     *
     * @param userId  用户ID
     * @param orderId 订单ID
     * @param payType 支付方式(可空,空则用订单创建时的支付方式)
     * @return 支付跳转参数
     */
    PaymentInitiateVO initiatePay(Long userId, Long orderId, String payType);

    /**
     * 处理易支付异步通知
     *
     * @param params 通知参数(全部请求参数,验签需包含扩展字段)
     * @return 应答内容:success=已受理,其他=失败(网关将重试)
     */
    String handleNotify(Map<String, String> params);

    /**
     * 主动向网关查单同步支付状态(用户支付完成后未收到回调时的补偿)
     *
     * @param userId  用户ID
     * @param orderId 订单ID
     * @return 同步后的订单VO
     */
    RechargeOrderVO syncOrderStatus(Long userId, Long orderId);
}
