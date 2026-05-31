package com.tidecanvas.model.dto;

import lombok.Data;

import java.util.List;

/**
 * 帖子更新DTO
 */
@Data
public class PostUpdateDTO {

    private String title;

    private String content;

    private List<String> images;

    private String category;

    private List<String> tags;

    private Integer status;
}
