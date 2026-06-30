package com.tidecanvas.model.query;

import lombok.Data;
import lombok.EqualsAndHashCode;

@Data
@EqualsAndHashCode(callSuper = true)
public class AiTaskQuery extends PageQuery {
    private String handler;
    private Integer status;
    private Long projectId;
}
