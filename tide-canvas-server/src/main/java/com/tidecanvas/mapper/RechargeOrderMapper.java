package com.tidecanvas.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.tidecanvas.model.entity.RechargeOrderDO;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Update;

public interface RechargeOrderMapper extends BaseMapper<RechargeOrderDO> {

    /**
     * 条件入账：待支付或已超时的订单都可被确认为已支付。
     * 接受「已超时」是为了不吞钱——订单超时关闭后，网关迟到回调或管理员手动确认仍能正常发放积分。
     */
    @Update("""
            UPDATE recharge_order
            SET status = #{paidStatus}, paid_time = NOW(), update_time = NOW(),
                payment_no = COALESCE(#{paymentNo}, payment_no),
                payment_method = COALESCE(#{paymentMethod}, payment_method)
            WHERE id = #{id} AND status IN (#{pendingStatus}, #{timeoutStatus}) AND deleted = 0
            """)
    int markPaidIfPayable(@Param("id") Long id,
                          @Param("pendingStatus") Integer pendingStatus,
                          @Param("timeoutStatus") Integer timeoutStatus,
                          @Param("paidStatus") Integer paidStatus,
                          @Param("paymentNo") String paymentNo,
                          @Param("paymentMethod") String paymentMethod);

    @Update("""
            UPDATE recharge_order
            SET status = #{cancelledStatus}, update_time = NOW()
            WHERE id = #{id} AND status = #{pendingStatus} AND deleted = 0
            """)
    int markCancelledIfPending(@Param("id") Long id,
                               @Param("pendingStatus") Integer pendingStatus,
                               @Param("cancelledStatus") Integer cancelledStatus);

    /** 把超过截止时间仍待支付的订单批量标记为已超时，返回关闭笔数 */
    @Update("""
            UPDATE recharge_order
            SET status = #{timeoutStatus}, update_time = NOW()
            WHERE status = #{pendingStatus} AND deleted = 0 AND create_time < #{cutoff}
            """)
    int markTimeoutBeforeCutoff(@Param("pendingStatus") Integer pendingStatus,
                                @Param("timeoutStatus") Integer timeoutStatus,
                                @Param("cutoff") String cutoff);
}
