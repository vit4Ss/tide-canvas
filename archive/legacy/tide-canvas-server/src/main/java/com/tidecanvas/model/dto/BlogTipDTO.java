package com.tidecanvas.model.dto;

import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;
import lombok.Data;

/**
 * 博客打赏DTO
 */
@Data
public class BlogTipDTO {

    @NotNull(message = "打赏金额不能为空")
    @Min(value = 1, message = "打赏金额最小为1")
    private Integer amount;
}
