package com.tidecanvas.model.entity;

import com.baomidou.mybatisplus.annotation.TableName;
import com.tidecanvas.common.BaseEntity;
import lombok.Data;
import lombok.EqualsAndHashCode;

@Data
@EqualsAndHashCode(callSuper = true)
@TableName("ai_provider")
public class AiProviderDO extends BaseEntity {
    private String name;
    private String providerType;
    private String apiKey;
    private String backupKeys;
    private String baseUrl;
    private Integer status;
    private Integer priority;
    private Integer rateLimit;
    private String config;
}
