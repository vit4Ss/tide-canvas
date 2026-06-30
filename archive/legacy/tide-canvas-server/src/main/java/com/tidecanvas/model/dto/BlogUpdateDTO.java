package com.tidecanvas.model.dto;

import lombok.Data;

import java.util.List;

/**
 * 博客更新DTO
 */
@Data
public class BlogUpdateDTO {

    private String title;

    private String content;

    private String summary;

    private String coverImage;

    private String category;

    private List<String> tags;

    private Integer pointsRequired;

    private Integer status;
}
