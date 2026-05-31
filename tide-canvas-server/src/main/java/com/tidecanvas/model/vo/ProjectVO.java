package com.tidecanvas.model.vo;

import lombok.Data;
import java.time.LocalDateTime;

@Data
public class ProjectVO {
    private Long id;
    private String name;
    private String description;
    private String thumbnail;
    private Integer status;
    private Boolean isPublic;
    /** 画布编辑 URL 的不透明短 token */
    private String urlToken;
    private LocalDateTime createTime;
    private LocalDateTime updateTime;
}
