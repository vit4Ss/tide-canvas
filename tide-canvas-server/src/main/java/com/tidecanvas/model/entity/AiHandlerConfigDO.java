package com.tidecanvas.model.entity;

import com.baomidou.mybatisplus.annotation.TableName;
import com.tidecanvas.common.BaseEntity;
import lombok.Data;
import lombok.EqualsAndHashCode;

@Data
@EqualsAndHashCode(callSuper = true)
@TableName("ai_handler_config")
public class AiHandlerConfigDO extends BaseEntity {
    private String handlerName;
    private String displayName;
    private String description;
    private String inputSchema;
    private Long defaultModelId;
    private Integer asyncFlag;
    private Integer status;
    private Integer sortOrder;
    private Integer pointCost;
}
