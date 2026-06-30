package com.tidecanvas.model.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import lombok.Data;

@Data
public class TeamCreateDTO {
    @NotBlank(message = "团队名称不能为空")
    @Size(max = 64, message = "团队名称过长")
    private String name;
}
