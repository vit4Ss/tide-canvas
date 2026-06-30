package com.tidecanvas.model.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import lombok.Data;

import java.util.List;

/**
 * 博客创建DTO
 */
@Data
public class BlogCreateDTO {

    @NotBlank(message = "标题不能为空")
    @Size(max = 200, message = "标题最多200个字符")
    private String title;

    @NotBlank(message = "内容不能为空")
    private String content;

    private String summary;

    private String coverImage;

    private String category;

    private List<String> tags;

    private Integer pointsRequired = 0;
}
