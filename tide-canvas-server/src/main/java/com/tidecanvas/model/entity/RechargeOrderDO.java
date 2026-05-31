package com.tidecanvas.model.entity;

import com.baomidou.mybatisplus.annotation.TableName;
import com.tidecanvas.common.BaseEntity;
import lombok.Data;
import lombok.EqualsAndHashCode;
import java.math.BigDecimal;
import java.time.LocalDateTime;

@Data
@EqualsAndHashCode(callSuper = true)
@TableName("recharge_order")
public class RechargeOrderDO extends BaseEntity {
    private String orderNo;
    private Long userId;
    private BigDecimal amount;
    private Integer pointsAmount;
    private String paymentMethod;
    private String paymentNo;
    private Integer status;
    private LocalDateTime paidTime;
}
