package com.tidecanvas.model.dto;

import jakarta.validation.constraints.NotBlank;
import lombok.Data;

/**
 * 申请前端直传凭据 DTO。
 *
 * @author tidecanvas
 */
@Data
public class FilePresignDTO {

    @NotBlank(message = "文件名不能为空")
    private String filename;

    /** MIME 类型，可空（空则按 application/octet-stream 处理） */
    private String contentType;

    /** 可选，不传则由 contentType 推断 image / video / other */
    private String fileType;
}
