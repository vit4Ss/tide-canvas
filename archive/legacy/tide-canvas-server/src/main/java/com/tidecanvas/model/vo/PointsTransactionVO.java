package com.tidecanvas.model.vo;

import lombok.Data;

import java.time.LocalDateTime;

/**
 * 积分交易记录VO
 */
@Data
public class PointsTransactionVO {

    private Long id;

    private Long userId;

    private Integer amount;

    private Integer balanceAfter;

    private Integer type;

    private String typeName;

    private Long bizId;

    private String remark;

    private LocalDateTime createTime;
}
