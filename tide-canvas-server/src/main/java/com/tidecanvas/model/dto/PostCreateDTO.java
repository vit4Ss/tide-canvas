package com.tidecanvas.model.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import lombok.Data;

import java.util.List;

/**
 * 帖子创建DTO
 */
@Data
public class PostCreateDTO {

    @NotBlank(message = "标题不能为空")
    @Size(max = 200, message = "标题最多200个字符")
    private String title;

    @NotBlank(message = "内容不能为空")
    private String content;

    private List<String> images;

    private String category;

    private List<String> tags;
}
