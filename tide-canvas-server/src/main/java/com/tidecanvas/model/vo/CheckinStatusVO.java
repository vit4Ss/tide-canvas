package com.tidecanvas.model.vo;

import lombok.Data;

/**
 * 签到状态VO
 */
@Data
public class CheckinStatusVO {

    private Boolean checkedInToday;

    private Integer streakDays;

    private Integer pointsAwarded;
}
