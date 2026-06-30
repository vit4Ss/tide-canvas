package com.tidecanvas.model.vo;

import lombok.Data;
import java.time.LocalDateTime;

@Data
public class AiTaskVO {
    private Long id;
    private String handlerName;
    private String modelName;
    private Integer status;
    private Integer progress;
    private String resultUrl;
    private String resultMeta;
    private String errorMsg;
    private LocalDateTime createTime;
    private LocalDateTime completeTime;
}
