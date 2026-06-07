package com.tidecanvas.model.entity;

import com.baomidou.mybatisplus.annotation.TableName;
import com.tidecanvas.common.BaseEntity;
import lombok.Data;
import lombok.EqualsAndHashCode;

import java.time.LocalDateTime;

/**
 * 兑换码。
 *
 * @author tidecanvas
 */
@Data
@EqualsAndHashCode(callSuper = true)
@TableName("redeem_code")
public class RedeemCodeDO extends BaseEntity {

    /** 兑换码 */
    private String code;

    /** 兑换积分 */
    private Integer points;

    /** 0未使用 / 1已使用 / 2已停用 */
    private Integer status;

    /** 使用者用户ID */
    private Long usedBy;

    private LocalDateTime usedTime;

    /** 有效期（null=永久有效） */
    private LocalDateTime expireTime;

    /** 批次号 */
    private String batchNo;

    private String remark;
}
