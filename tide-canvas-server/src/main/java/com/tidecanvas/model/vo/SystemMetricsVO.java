package com.tidecanvas.model.vo;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

/**
 * 服务器系统指标（CPU/内存/磁盘/JVM/认证统计/健康评分）。
 *
 * @author tidecanvas
 */
@Data
public class SystemMetricsVO {

    /** CPU 使用率 % */
    private double cpuUsage;
    private int cpuCores;
    /** 系统负载（1 分钟，Windows 下为 -1） */
    private double loadAverage;

    /** 物理内存（字节） */
    private long memUsed;
    private long memTotal;
    private double memUsage;

    /** JVM 堆（字节） */
    private long jvmHeapUsed;
    private long jvmHeapMax;
    private double jvmHeapUsage;
    private long pid;

    private String osName;
    private String osArch;
    /** 运行时长（毫秒） */
    private long uptimeMs;
    /** 在线网卡数 */
    private int onlineNics;

    /** 健康评分 0-100 */
    private int healthScore;

    private List<DiskVO> disks;

    /** 近 7 天认证：成功 / 失败 / 成功率 % */
    private long authSuccess;
    private long authFail;
    private double authSuccessRate;

    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    public static class DiskVO {
        private String path;
        private long total;
        private long free;
        private long used;
        private double usage;
    }
}
