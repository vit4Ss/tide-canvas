package com.tidecanvas.model.dto;

import lombok.Data;

@Data
public class BannerUpdateDTO {
    private String title;
    private String imageUrl;
    private String linkUrl;
    private Integer sortOrder;
    private Integer status;
}
