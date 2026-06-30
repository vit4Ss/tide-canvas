package com.tidecanvas.model.dto;

import jakarta.validation.constraints.NotNull;
import lombok.Data;

/**
 * 管理员积分调整DTO
 */
@Data
public class AdminPointsAdjustDTO {

    @NotNull(message = "用户ID不能为空")
    private Long userId;

    @NotNull(message = "调整金额不能为空")
    private Integer amount;

    private String remark;
}
