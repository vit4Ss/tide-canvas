package com.tidecanvas.model.dto;

import jakarta.validation.constraints.NotBlank;
import lombok.Data;

@Data
public class BannerCreateDTO {
    @NotBlank(message = "标题不能为空")
    private String title;

    @NotBlank(message = "图片URL不能为空")
    private String imageUrl;

    private String linkUrl;
    private Integer sortOrder;
    private Integer status;
}
