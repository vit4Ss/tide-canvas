package com.tidecanvas.model.dto;

import jakarta.validation.constraints.Size;
import lombok.Data;

@Data
public class ProjectUpdateDTO {
    @Size(max = 128, message = "项目名称最多128个字符")
    private String name;
    private String description;
    private Integer status;
    private Boolean isPublic;
}
