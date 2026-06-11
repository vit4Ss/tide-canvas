package com.tidecanvas.model.vo;

import lombok.Data;

import java.math.BigDecimal;
import java.time.LocalDateTime;

/**
 * 充值订单VO
 */
@Data
public class RechargeOrderVO {

    private Long id;

    private String orderNo;

    private BigDecimal amount;

    private Integer pointsAmount;

    private String paymentMethod;

    private String paymentNo;

    private Integer status;

    private String statusName;

    private LocalDateTime paidTime;

    private LocalDateTime createTime;
}
