package com.tidecanvas.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.tidecanvas.model.entity.AccessLogDO;
import org.apache.ibatis.annotations.Param;

import java.util.List;
import java.util.Map;

public interface AccessLogMapper extends BaseMapper<AccessLogDO> {

    /** 今日访问量 PV */
    Long countTodayPv();

    /** 今日独立访客 UV(按 IP 去重) */
    Long countTodayUv();

    /** 按日期统计每日 PV */
    List<Map<String, Object>> pvByDateRange(@Param("startDate") String startDate, @Param("endDate") String endDate);

    /** 按日期统计每日 UV(按 IP 去重) */
    List<Map<String, Object>> uvByDateRange(@Param("startDate") String startDate, @Param("endDate") String endDate);

    /** 热门接口 Top N */
    List<Map<String, Object>> topPaths(@Param("startDate") String startDate, @Param("endDate") String endDate, @Param("limit") int limit);

    /** 清理指定时间之前的访问日志,返回删除行数 */
    int deleteBefore(@Param("before") String before);
}
