package com.tidecanvas.service;

import com.tidecanvas.model.vo.CheckinCalendarVO;
import com.tidecanvas.model.vo.CheckinStatusVO;

/**
 * 签到服务接口
 *
 * @author tidecanvas
 */
public interface CheckinService {

    /**
     * 每日签到
     *
     * @param userId 用户ID
     * @return 签到结果
     */
    CheckinStatusVO checkin(Long userId);

    /**
     * 获取今日签到状态
     *
     * @param userId 用户ID
     * @return 签到状态
     */
    CheckinStatusVO getStatus(Long userId);

    /**
     * 获取签到日历
     *
     * @param userId 用户ID
     * @param year   年份
     * @param month  月份
     * @return 签到日历
     */
    CheckinCalendarVO getCalendar(Long userId, int year, int month);
}
