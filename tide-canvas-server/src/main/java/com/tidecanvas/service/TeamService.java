package com.tidecanvas.service;

import com.tidecanvas.model.dto.TeamCreateDTO;
import com.tidecanvas.model.dto.TeamJoinDTO;
import com.tidecanvas.model.vo.TeamVO;

import java.math.BigDecimal;
import java.util.List;

public interface TeamService {

    TeamVO createTeam(Long userId, TeamCreateDTO dto);

    TeamVO joinByCode(Long userId, TeamJoinDTO dto);

    void leaveTeam(Long userId);

    void removeMember(Long operatorId, Long targetUserId);

    void disband(Long userId);

    /** 当前用户的团队（含成员列表）；不在团队返回 null */
    TeamVO getMyTeam(Long userId);

    /** 当前用户可见资源的归属用户ID集合：无团队→[userId]，有团队→全体成员ID（用于素材/项目/历史共享） */
    List<Long> getTeamMemberIds(Long userId);

    /** AI 消耗加价系数：无团队→1，有团队→全局配置(clamp≥1) */
    BigDecimal getPriceFactor(Long userId);

    /** operator 是否为 ownerUserId 同团队的团队管理员（用于放行删除队友资源） */
    boolean isTeamAdminOf(Long operatorId, Long ownerUserId);
}
