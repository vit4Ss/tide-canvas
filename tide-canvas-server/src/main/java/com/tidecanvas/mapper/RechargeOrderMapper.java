package com.tidecanvas.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.tidecanvas.model.entity.RechargeOrderDO;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Update;

public interface RechargeOrderMapper extends BaseMapper<RechargeOrderDO> {

    @Update("""
            UPDATE recharge_order
            SET status = #{paidStatus}, paid_time = NOW(), update_time = NOW(),
                payment_no = COALESCE(#{paymentNo}, payment_no),
                payment_method = COALESCE(#{paymentMethod}, payment_method)
            WHERE id = #{id} AND status = #{pendingStatus} AND deleted = 0
            """)
    int markPaidIfPending(@Param("id") Long id,
                          @Param("pendingStatus") Integer pendingStatus,
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
}
