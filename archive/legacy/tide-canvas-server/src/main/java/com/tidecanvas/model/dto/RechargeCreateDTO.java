package com.tidecanvas.model.dto;

import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import lombok.Data;

import java.math.BigDecimal;

/**
 * 充值创建DTO
 */
@Data
public class RechargeCreateDTO {

    @NotNull(message = "充值金额不能为空")
    @DecimalMin(value = "0.01", message = "充值金额最小为0.01")
    @DecimalMax(value = "100000", message = "单笔充值金额不能超过100000元")
    private BigDecimal amount;

    @Size(max = 16, message = "支付方式无效")
    private String paymentMethod;
}
