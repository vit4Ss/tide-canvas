package com.tidecanvas.model.vo;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

/**
 * 数据面板图表VO(近7天趋势、AI调用分布、模型排行)
 *
 * @author tidecanvas
 */
@Data
public class DashboardChartsVO {

    /** 近7天用户增长(逐日,无数据补零) */
    private List<DailyTrendVO> userTrend;

    /** AI 调用分布(按 Handler,Top5 + 其他) */
    private List<NameValueVO> aiDistribution;

    /** 近7天创作量(项目创建数与AI调用次数) */
    private List<DailyCreationVO> dailyCreation;

    /** 模型使用排行 Top5 */
    private List<NameValueVO> modelUsage;

    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    public static class DailyTrendVO {

        /** 日期标签 MM/dd */
        private String date;

        private Long newUsers;

        private Long activeUsers;
    }

    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    public static class DailyCreationVO {

        private String date;

        private Long projects;

        private Long aiCalls;
    }

    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    public static class NameValueVO {

        private String name;

        private Long value;
    }
}
