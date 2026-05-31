package com.tidecanvas.model.dto;

import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.NotNull;
import lombok.Data;

import java.math.BigDecimal;

/**
 * 充值创建DTO
 */
@Data
public class RechargeCreateDTO {

    @NotNull(message = "充值金额不能为空")
    @DecimalMin(value = "0.01", message = "充值金额最小为0.01")
    private BigDecimal amount;

    private String paymentMethod;
}
