package com.tidecanvas.model.vo;

import lombok.Data;

@Data
public class DashboardOverviewVO {
    private Long totalUsers;
    private Long todayNewUsers;
    /** 今日活跃用户(今天登录过) = DAU */
    private Long activeUsers;
    private Long totalApiCalls;
    private Long todayApiCalls;
    private Long totalProjects;
    private Long todayNewProjects;
    private Long totalStorageBytes;
    /** 今日访问量 PV */
    private Long todayVisits;
    /** 今日独立访客 UV */
    private Long todayVisitors;
    /** 今日成功登录次数 */
    private Long todayLogins;
    /** 近7天活跃用户数 WAU */
    private Long activeWeek;
    /** 近30天活跃用户数 MAU */
    private Long activeMonth;
}
