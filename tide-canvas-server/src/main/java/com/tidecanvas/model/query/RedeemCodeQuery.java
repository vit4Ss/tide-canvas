package com.tidecanvas.model.query;

import lombok.Data;
import lombok.EqualsAndHashCode;

/**
 * 兑换码查询。
 *
 * @author tidecanvas
 */
@Data
@EqualsAndHashCode(callSuper = true)
public class RedeemCodeQuery extends PageQuery {
    private String code;
    /** 0未使用 / 1已使用 / 2已停用 */
    private Integer status;
    private String batchNo;
}
