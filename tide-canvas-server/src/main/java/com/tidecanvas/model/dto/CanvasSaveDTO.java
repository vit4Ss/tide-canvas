package com.tidecanvas.model.dto;

import jakarta.validation.constraints.NotBlank;
import lombok.Data;

@Data
public class CanvasSaveDTO {
    @NotBlank(message = "画布数据不能为空")
    private String canvasData;
    private String thumbnail;
}
