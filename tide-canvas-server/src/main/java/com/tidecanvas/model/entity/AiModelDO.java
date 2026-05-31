package com.tidecanvas.model.entity;

import com.baomidou.mybatisplus.annotation.TableName;
import com.tidecanvas.common.BaseEntity;
import lombok.Data;
import lombok.EqualsAndHashCode;
import java.math.BigDecimal;

@Data
@EqualsAndHashCode(callSuper = true)
@TableName("ai_model")
public class AiModelDO extends BaseEntity {
    private Long providerId;
    private String name;
    private String icon;
    private String modelId;
    private String type;
    private String supportedHandlers;
    private String config;
    private BigDecimal costPerCall;
    private Integer pointCost;
    private Integer status;
}
