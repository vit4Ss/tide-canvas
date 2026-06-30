package com.tidecanvas.model.dto;

import jakarta.validation.constraints.NotBlank;
import lombok.Data;

@Data
public class TeamJoinDTO {
    @NotBlank(message = "邀请码不能为空")
    private String inviteCode;
}
