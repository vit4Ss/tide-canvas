package com.tidecanvas.model.dto;

import jakarta.validation.constraints.NotBlank;
import lombok.Data;

/**
 * 前端直传完成后登记文件 DTO。
 *
 * @author tidecanvas
 */
@Data
public class FileRegisterDTO {

    /** presign 返回的对象键 */
    @NotBlank(message = "对象键不能为空")
    private String key;

    private String originalName;

    private String contentType;

    /** 可选，不传则由 contentType 推断 */
    private String fileType;
}
