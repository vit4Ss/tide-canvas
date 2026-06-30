package com.tidecanvas.model.query;

import lombok.Data;
import lombok.EqualsAndHashCode;

/**
 * 积分交易记录查询条件
 */
@Data
@EqualsAndHashCode(callSuper = true)
public class PointsTransactionQuery extends PageQuery {

    private Long userId;

    private Integer type;

    private String startTime;

    private String endTime;
}
