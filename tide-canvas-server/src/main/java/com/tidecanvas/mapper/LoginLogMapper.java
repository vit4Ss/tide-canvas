package com.tidecanvas.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.tidecanvas.model.entity.LoginLogDO;
import org.apache.ibatis.annotations.Param;

import java.util.List;
import java.util.Map;

public interface LoginLogMapper extends BaseMapper<LoginLogDO> {

    /** 今日成功登录次数 */
    Long countTodayLogins();

    /** 按日期统计每日成功登录次数 */
    List<Map<String, Object>> loginByDateRange(@Param("startDate") String startDate, @Param("endDate") String endDate);

    /** 清理指定时间之前的登录日志,返回删除行数 */
    int deleteBefore(@Param("before") String before);
}
