package com.tidecanvas.model.vo;

import lombok.Data;

/**
 * 兑换结果 VO。
 *
 * @author tidecanvas
 */
@Data
public class RedeemResultVO {
    /** 本次兑换获得的积分 */
    private Integer points;
    /** 兑换后的积分余额 */
    private Integer balance;
}
