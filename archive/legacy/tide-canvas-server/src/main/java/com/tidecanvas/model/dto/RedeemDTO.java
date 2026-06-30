package com.tidecanvas.model.dto;

import jakarta.validation.constraints.NotBlank;
import lombok.Data;

/**
 * 用户兑换请求。
 *
 * @author tidecanvas
 */
@Data
public class RedeemDTO {

    @NotBlank(message = "兑换码不能为空")
    private String code;
}
