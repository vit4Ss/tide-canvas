package com.tidecanvas.model.dto;

import jakarta.validation.constraints.NotBlank;
import lombok.Data;

/**
 * 管理员手动封禁 DTO。
 *
 * @author tidecanvas
 */
@Data
public class ManualBanDTO {

    /** 维度：user / ip */
    @NotBlank(message = "类型不能为空")
    private String type;

    /** 用户ID 或 IP */
    @NotBlank(message = "目标不能为空")
    private String value;

    /** 封禁时长（秒），为空则用默认时长 */
    private Long seconds;

    private String reason;
}
