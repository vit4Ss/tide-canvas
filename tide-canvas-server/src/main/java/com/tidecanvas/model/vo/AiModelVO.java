package com.tidecanvas.model.vo;

import lombok.Data;

import java.time.LocalDateTime;

@Data
public class AiModelVO {
    private Long id;
    private String name;
    private String icon;
    private String modelId;
    private String type;
    private String supportedHandlers;
    private String config;
    private Integer pointCost;
    /** 状态(0:禁用,1:启用) —— 管理列表需要，缺失会导致前端永远显示禁用 */
    private Integer status;
    private Long providerId;
    /** 供应商名称（管理列表展示用，由 service 关联填充） */
    private String providerName;
    private LocalDateTime createTime;
}
