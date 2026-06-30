package com.tidecanvas.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.tidecanvas.model.entity.SysFileDO;
import org.apache.ibatis.annotations.Param;

import java.util.List;
import java.util.Map;

public interface SysFileMapper extends BaseMapper<SysFileDO> {

    Long sumStorageByUserId(@Param("userId") Long userId);

    Long sumTotalStorage();

    List<Map<String, Object>> countByFileType();
}
