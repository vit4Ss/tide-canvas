package com.tidecanvas.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.tidecanvas.model.entity.TeamMemberDO;
import org.apache.ibatis.annotations.Delete;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

import java.util.List;

public interface TeamMemberMapper extends BaseMapper<TeamMemberDO> {

    @Select("SELECT user_id FROM team_member WHERE deleted = 0 AND team_id = #{teamId}")
    List<Long> selectUserIdsByTeam(@Param("teamId") Long teamId);

    /** 物理删除：因 deleted 是 @TableLogic 软删，软删会占住 uk_user_id 致用户无法重新加入团队 */
    @Delete("DELETE FROM team_member WHERE id = #{id}")
    int physicalDeleteById(@Param("id") Long id);

    @Delete("DELETE FROM team_member WHERE team_id = #{teamId}")
    int physicalDeleteByTeam(@Param("teamId") Long teamId);
}
