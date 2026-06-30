package com.tidecanvas.model.entity;

import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableName;
import com.tidecanvas.common.BaseEntity;
import lombok.Data;
import lombok.EqualsAndHashCode;
import java.math.BigDecimal;
import java.time.LocalDateTime;

@Data
@EqualsAndHashCode(callSuper = true)
@TableName("ai_task")
public class AiTaskDO extends BaseEntity {
    private Long userId;
    private Long projectId;
    private String handlerName;
    private Long modelId;
    private String inputParams;
    private String resultUrl;
    private String resultMeta;
    private Integer status;
    private Integer progress;
    private String errorMsg;
    private BigDecimal cost;
    private LocalDateTime completeTime;

    @TableField(exist = false)
    private String modelName;
}
