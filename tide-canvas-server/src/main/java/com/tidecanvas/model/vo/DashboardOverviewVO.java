package com.tidecanvas.model.vo;

import lombok.Data;

@Data
public class DashboardOverviewVO {
    private Long totalUsers;
    private Long todayNewUsers;
    private Long activeUsers;
    private Long totalApiCalls;
    private Long todayApiCalls;
    private Long totalProjects;
    private Long totalStorageBytes;
}
