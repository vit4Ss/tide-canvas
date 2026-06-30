package com.tidecanvas.model.vo;

import lombok.Data;

@Data
public class AiHandlerVO {
    private String handlerName;
    private String displayName;
    private String description;
    private String inputSchema;
    private Integer asyncFlag;
    private Long defaultModelId;
    private Integer pointCost;
}
