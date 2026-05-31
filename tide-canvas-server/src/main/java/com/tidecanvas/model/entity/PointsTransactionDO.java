package com.tidecanvas.model.entity;

import com.baomidou.mybatisplus.annotation.TableName;
import com.tidecanvas.common.BaseEntity;
import lombok.Data;
import lombok.EqualsAndHashCode;

@Data
@EqualsAndHashCode(callSuper = true)
@TableName("points_transaction")
public class PointsTransactionDO extends BaseEntity {
    private Long userId;
    private Integer amount;
    private Integer balanceAfter;
    private Integer type;
    private Long bizId;
    private String remark;
}
