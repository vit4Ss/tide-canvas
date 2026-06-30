package com.tidecanvas.model.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import lombok.Data;
import java.util.Map;

@Data
public class AiGenerateDTO {
    @NotBlank(message = "handler不能为空")
    private String handler;

    @NotBlank(message = "模型ID不能为空")
    private String modelId;

    private Long projectId;

    @NotNull(message = "输入参数不能为空")
    private Map<String, Object> input;
}
