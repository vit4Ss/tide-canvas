package com.tidecanvas.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.tidecanvas.model.entity.SysUserDO;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

import java.util.List;
import java.util.Map;

public interface SysUserMapper extends BaseMapper<SysUserDO> {

    @Select("SELECT * FROM sys_user WHERE deleted = 0 AND (username = #{account} OR email = #{account} OR phone = #{account})")
    SysUserDO selectByAccount(@Param("account") String account);

    Long countTodayNew();

    Long countTodayActive();

    SysUserDO selectForUpdate(@Param("id") Long id);

    List<Map<String, Object>> countByDateRange(@Param("startDate") String startDate, @Param("endDate") String endDate);

    List<Map<String, Object>> countActiveByDateRange(@Param("startDate") String startDate, @Param("endDate") String endDate);
}
