package com.tidecanvas.model.query;

import lombok.Data;
import lombok.EqualsAndHashCode;

/**
 * 管理员积分查询条件
 */
@Data
@EqualsAndHashCode(callSuper = true)
public class AdminPointsQuery extends PageQuery {

    private Long userId;

    private Integer type;

    private String startTime;

    private String endTime;
}
