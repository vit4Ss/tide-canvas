package com.tidecanvas.model.vo;

import lombok.Data;

import java.time.LocalDateTime;

/**
 * 兑换码 VO（管理端列表展示）。
 *
 * @author tidecanvas
 */
@Data
public class RedeemCodeVO {
    private Long id;
    private String code;
    private Integer points;
    private Integer status;
    private Long usedBy;
    private LocalDateTime usedTime;
    private LocalDateTime expireTime;
    private String batchNo;
    private String remark;
    private LocalDateTime createTime;
}
