package com.tidecanvas.model.vo;

import lombok.Data;

import java.time.LocalDateTime;
import java.util.List;

@Data
public class RoleVO {
    private Long id;
    private String name;
    private String code;
    private List<String> permissions;
    private Integer builtin;
    private String remark;
    private LocalDateTime createTime;
    private LocalDateTime updateTime;
}
