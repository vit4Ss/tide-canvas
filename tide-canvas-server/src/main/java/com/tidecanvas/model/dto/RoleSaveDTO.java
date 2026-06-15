package com.tidecanvas.model.dto;

import jakarta.validation.constraints.NotBlank;
import lombok.Data;

import java.util.List;

@Data
public class RoleSaveDTO {

    @NotBlank(message = "角色名不能为空")
    private String name;

    @NotBlank(message = "角色编码不能为空")
    private String code;

    /** 权限码列表 */
    private List<String> permissions;

    private String remark;
}
