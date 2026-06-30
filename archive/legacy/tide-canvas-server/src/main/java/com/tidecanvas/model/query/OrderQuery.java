package com.tidecanvas.model.query;

import lombok.Data;
import lombok.EqualsAndHashCode;

/**
 * 订单查询条件
 */
@Data
@EqualsAndHashCode(callSuper = true)
public class OrderQuery extends PageQuery {

    private Integer status;

    private String startTime;

    private String endTime;
}
