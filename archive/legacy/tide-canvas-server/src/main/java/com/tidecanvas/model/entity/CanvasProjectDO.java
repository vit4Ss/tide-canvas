package com.tidecanvas.model.entity;

import com.baomidou.mybatisplus.annotation.TableName;
import com.tidecanvas.common.BaseEntity;
import lombok.Data;
import lombok.EqualsAndHashCode;

@Data
@EqualsAndHashCode(callSuper = true)
@TableName("canvas_project")
public class CanvasProjectDO extends BaseEntity {
    private Long userId;
    private String name;
    private String description;
    private String thumbnail;
    private String canvasData;
    private Integer isPublic;
    /** 公开分享 token（/share/{token}） */
    private String shareToken;
    /** 画布编辑 URL 的不透明短 token（/canvas/{urlToken}），避免在地址栏暴露真实雪花ID */
    private String urlToken;
    private Integer status;
}
