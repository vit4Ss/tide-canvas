package com.tidecanvas.model.vo;

import lombok.Data;
import java.time.LocalDateTime;

@Data
public class AiProviderVO {
    private Long id;
    private String name;
    private String providerType;
    private String baseUrl;
    /** 脱敏后的 API Key（仅展示前4+后4位） */
    private String apiKey;
    private Integer status;
    private Integer priority;
    private Integer rateLimit;
    private String config;
    private LocalDateTime createTime;
}
