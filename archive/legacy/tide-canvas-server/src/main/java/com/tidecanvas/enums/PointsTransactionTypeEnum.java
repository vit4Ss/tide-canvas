package com.tidecanvas.enums;

import lombok.AllArgsConstructor;
import lombok.Getter;

@Getter
@AllArgsConstructor
public enum PointsTransactionTypeEnum {
    RECHARGE(1, "充值"),
    CHECKIN(2, "签到"),
    AI_CONSUME(3, "AI消耗"),
    BLOG_VIEW(4, "查看博客"),
    TIP_OUT(5, "打赏支出"),
    TIP_IN(6, "收到打赏"),
    ADMIN_ADJUST(7, "管理员调整"),
    AI_REFUND(8, "AI生成失败返还"),
    REDEEM(9, "兑换码兑换");

    private final int code;
    private final String desc;

    public static PointsTransactionTypeEnum of(int code) {
        for (PointsTransactionTypeEnum type : values()) {
            if (type.code == code) {
                return type;
            }
        }
        return null;
    }
}
