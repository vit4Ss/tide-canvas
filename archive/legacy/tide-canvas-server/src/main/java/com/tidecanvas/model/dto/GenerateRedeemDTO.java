package com.tidecanvas.model.dto;

import com.fasterxml.jackson.annotation.JsonFormat;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;
import lombok.Data;

import java.time.LocalDateTime;

/**
 * 批量生成兑换码请求。
 *
 * @author tidecanvas
 */
@Data
public class GenerateRedeemDTO {

    @NotNull(message = "数量不能为空")
    @Min(value = 1, message = "数量至少 1")
    @Max(value = 1000, message = "单次最多生成 1000 个")
    private Integer count;

    @NotNull(message = "积分不能为空")
    @Min(value = 1, message = "积分至少 1")
    private Integer points;

    /** 有效期（留空=永久），格式 yyyy-MM-dd HH:mm:ss */
    @JsonFormat(shape = JsonFormat.Shape.STRING, pattern = "yyyy-MM-dd HH:mm:ss")
    private LocalDateTime expireTime;

    private String remark;
}
