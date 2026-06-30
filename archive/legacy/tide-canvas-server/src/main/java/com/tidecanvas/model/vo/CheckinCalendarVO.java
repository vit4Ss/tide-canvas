package com.tidecanvas.model.vo;

import lombok.Data;

import java.util.List;

/**
 * 签到日历VO
 */
@Data
public class CheckinCalendarVO {

    /**
     * 签到日期列表，格式：yyyy-MM-dd
     */
    private List<String> dates;
}
