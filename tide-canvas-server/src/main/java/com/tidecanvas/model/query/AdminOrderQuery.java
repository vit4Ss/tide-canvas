package com.tidecanvas.model.query;

import lombok.Data;
import lombok.EqualsAndHashCode;

/**
 * 管理员订单查询条件
 */
@Data
@EqualsAndHashCode(callSuper = true)
public class AdminOrderQuery extends PageQuery {

    private Long userId;

    private Integer status;

    private String orderNo;

    private String startTime;

    private String endTime;
}
