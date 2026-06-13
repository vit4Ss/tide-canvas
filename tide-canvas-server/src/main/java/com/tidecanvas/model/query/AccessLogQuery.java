package com.tidecanvas.model.query;

import lombok.Data;
import lombok.EqualsAndHashCode;

@Data
@EqualsAndHashCode(callSuper = true)
public class AccessLogQuery extends PageQuery {
    private Long userId;
    /** 路径关键字(模糊) */
    private String path;
    /** 用户名/IP 关键字(模糊) */
    private String keyword;
    private String startTime;
    private String endTime;
}
