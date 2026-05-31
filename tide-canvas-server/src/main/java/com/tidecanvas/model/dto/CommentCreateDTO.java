package com.tidecanvas.model.dto;

import jakarta.validation.constraints.NotBlank;
import lombok.Data;

/**
 * 评论创建DTO
 */
@Data
public class CommentCreateDTO {

    @NotBlank(message = "评论内容不能为空")
    private String content;

    private Long parentId;
}
