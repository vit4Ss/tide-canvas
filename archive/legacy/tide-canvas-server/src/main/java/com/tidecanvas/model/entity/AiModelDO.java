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
    /** 单次调用上游成本（USD，参考字段，仅后台可见） */
    private BigDecimal costPerCall;
    /** 每次调用消耗积分（支持小数；结算按「单价×张数×团队系数」总价向上取整） */
    private BigDecimal pointCost;
    private Integer status;
}
