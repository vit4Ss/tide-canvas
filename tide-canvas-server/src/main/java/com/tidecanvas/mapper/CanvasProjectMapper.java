package com.tidecanvas.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.tidecanvas.model.entity.CanvasProjectDO;
import org.apache.ibatis.annotations.Param;

import java.util.List;
import java.util.Map;

public interface CanvasProjectMapper extends BaseMapper<CanvasProjectDO> {

    CanvasProjectDO selectByShareToken(@Param("shareToken") String shareToken);

    Long countByUserId(@Param("userId") Long userId);

    List<Map<String, Object>> countByDateRange(@Param("startDate") String startDate, @Param("endDate") String endDate);
}
