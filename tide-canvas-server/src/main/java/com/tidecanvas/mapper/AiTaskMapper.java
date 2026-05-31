package com.tidecanvas.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.tidecanvas.model.entity.AiTaskDO;
import org.apache.ibatis.annotations.Param;

import java.util.List;
import java.util.Map;

public interface AiTaskMapper extends BaseMapper<AiTaskDO> {

    AiTaskDO selectWithModel(@Param("taskId") Long taskId);

    Long countTodayCalls();

    List<Map<String, Object>> countByHandler();

    List<Map<String, Object>> countByDateRange(@Param("startDate") String startDate, @Param("endDate") String endDate);

    List<Map<String, Object>> modelUsageRank(@Param("limit") int limit);
}
