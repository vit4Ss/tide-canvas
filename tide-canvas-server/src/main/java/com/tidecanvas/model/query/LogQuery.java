package com.tidecanvas.model.query;

import lombok.Data;
import lombok.EqualsAndHashCode;

@Data
@EqualsAndHashCode(callSuper = true)
public class LogQuery extends PageQuery {
    private Long userId;
    private String action;
    private String keyword;
    private String startTime;
    private String endTime;
}
