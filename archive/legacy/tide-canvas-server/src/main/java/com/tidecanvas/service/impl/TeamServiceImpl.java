package com.tidecanvas.service.impl;

import cn.hutool.core.util.IdUtil;
import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.core.conditions.update.LambdaUpdateWrapper;
import com.tidecanvas.common.ResultCode;
import com.tidecanvas.exception.BusinessException;
import com.tidecanvas.mapper.SysConfigMapper;
import com.tidecanvas.mapper.SysUserMapper;
import com.tidecanvas.mapper.TeamMapper;
import com.tidecanvas.mapper.TeamMemberMapper;
import com.tidecanvas.model.dto.TeamCreateDTO;
import com.tidecanvas.model.dto.TeamJoinDTO;
import com.tidecanvas.model.entity.SysConfigDO;
import com.tidecanvas.model.entity.SysUserDO;
import com.tidecanvas.model.entity.TeamDO;
import com.tidecanvas.model.entity.TeamMemberDO;
import com.tidecanvas.model.vo.TeamMemberVO;
import com.tidecanvas.model.vo.TeamVO;
import com.tidecanvas.service.TeamService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;

import java.math.BigDecimal;
import java.security.SecureRandom;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.function.Function;
import java.util.stream.Collectors;

@Slf4j
@Service
@RequiredArgsConstructor
public class TeamServiceImpl implements TeamService {

    private final TeamMapper teamMapper;
    private final TeamMemberMapper teamMemberMapper;
    private final SysUserMapper userMapper;
    private final SysConfigMapper configMapper;

    private static final String PRICE_FACTOR_KEY = "team.price.factor";
    private static final BigDecimal DEFAULT_FACTOR = new BigDecimal("1.5");
    // 邀请码字符集（剔除易混淆字符），8 位
    private static final char[] CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789".toCharArray();
    private static final SecureRandom RANDOM = new SecureRandom();
    private static final int CODE_LEN = 8;

    private static final int ROLE_MEMBER = 0;
    private static final int ROLE_ADMIN = 1;

    @Override
    @Transactional(rollbackFor = Exception.class)
    public TeamVO createTeam(Long userId, TeamCreateDTO dto) {
        assertNotInTeam(userId);
        TeamDO team = new TeamDO();
        team.setName(dto.getName().trim());
        team.setOwnerId(userId);
        team.setInviteCode(generateUniqueCode());
        team.setMemberCount(1);
        team.setDeleted(0);
        teamMapper.insert(team);

        insertMember(team.getId(), userId, ROLE_ADMIN);
        setUserTeam(userId, team.getId());
        return getMyTeam(userId);
    }

    @Override
    @Transactional(rollbackFor = Exception.class)
    public TeamVO joinByCode(Long userId, TeamJoinDTO dto) {
        assertNotInTeam(userId);
        TeamDO team = teamMapper.selectOne(new LambdaQueryWrapper<TeamDO>()
                .eq(TeamDO::getInviteCode, dto.getInviteCode().trim()));
        if (team == null) {
            throw new BusinessException(ResultCode.NOT_FOUND, "邀请码无效");
        }
        try {
            insertMember(team.getId(), userId, ROLE_MEMBER);
        } catch (DuplicateKeyException e) {
            // uk_user_id 并发兜底
            throw new BusinessException(ResultCode.BAD_REQUEST, "您已在一个团队中");
        }
        bumpMemberCount(team.getId(), 1);
        setUserTeam(userId, team.getId());
        return getMyTeam(userId);
    }

    @Override
    @Transactional(rollbackFor = Exception.class)
    public void leaveTeam(Long userId) {
        TeamMemberDO member = findMembership(userId);
        if (member == null) {
            throw new BusinessException(ResultCode.BAD_REQUEST, "您不在任何团队中");
        }
        if (member.getRole() != null && member.getRole() == ROLE_ADMIN) {
            throw new BusinessException(ResultCode.BAD_REQUEST, "团队管理员需先解散团队");
        }
        teamMemberMapper.physicalDeleteById(member.getId());
        bumpMemberCount(member.getTeamId(), -1);
        setUserTeam(userId, null);
    }

    @Override
    @Transactional(rollbackFor = Exception.class)
    public void removeMember(Long operatorId, Long targetUserId) {
        TeamMemberDO operator = findMembership(operatorId);
        if (operator == null || operator.getRole() == null || operator.getRole() != ROLE_ADMIN) {
            throw new BusinessException(ResultCode.FORBIDDEN, "仅团队管理员可移除成员");
        }
        if (operatorId.equals(targetUserId)) {
            throw new BusinessException(ResultCode.BAD_REQUEST, "管理员不能移除自己，请使用解散团队");
        }
        TeamMemberDO target = findMembership(targetUserId);
        if (target == null || !operator.getTeamId().equals(target.getTeamId())) {
            throw new BusinessException(ResultCode.BAD_REQUEST, "该成员不在你的团队中");
        }
        teamMemberMapper.physicalDeleteById(target.getId());
        bumpMemberCount(operator.getTeamId(), -1);
        setUserTeam(targetUserId, null);
    }

    @Override
    @Transactional(rollbackFor = Exception.class)
    public void disband(Long userId) {
        TeamMemberDO operator = findMembership(userId);
        if (operator == null || operator.getRole() == null || operator.getRole() != ROLE_ADMIN) {
            throw new BusinessException(ResultCode.FORBIDDEN, "仅团队管理员可解散团队");
        }
        Long teamId = operator.getTeamId();
        List<Long> memberIds = teamMemberMapper.selectUserIdsByTeam(teamId);
        if (!memberIds.isEmpty()) {
            userMapper.update(null, new LambdaUpdateWrapper<SysUserDO>()
                    .in(SysUserDO::getId, memberIds)
                    .set(SysUserDO::getTeamId, null));
        }
        teamMemberMapper.physicalDeleteByTeam(teamId);
        teamMapper.deleteById(teamId); // 团队本身逻辑删除即可
    }

    @Override
    public TeamVO getMyTeam(Long userId) {
        SysUserDO user = userMapper.selectById(userId);
        if (user == null || user.getTeamId() == null) {
            return null;
        }
        TeamDO team = teamMapper.selectById(user.getTeamId());
        if (team == null) {
            return null;
        }
        List<TeamMemberDO> members = teamMemberMapper.selectList(new LambdaQueryWrapper<TeamMemberDO>()
                .eq(TeamMemberDO::getTeamId, team.getId())
                .orderByAsc(TeamMemberDO::getCreateTime));
        List<Long> ids = members.stream().map(TeamMemberDO::getUserId).toList();
        Map<Long, SysUserDO> userMap = ids.isEmpty() ? Map.of()
                : userMapper.selectBatchIds(ids).stream().collect(Collectors.toMap(SysUserDO::getId, Function.identity()));

        List<TeamMemberVO> memberVOs = new ArrayList<>();
        for (TeamMemberDO m : members) {
            SysUserDO u = userMap.get(m.getUserId());
            TeamMemberVO vo = new TeamMemberVO();
            vo.setUserId(m.getUserId());
            vo.setRole(m.getRole());
            vo.setIsOwner(team.getOwnerId().equals(m.getUserId()));
            vo.setJoinTime(m.getCreateTime());
            if (u != null) {
                vo.setUsername(u.getUsername());
                vo.setNickname(u.getNickname());
                vo.setAvatar(u.getAvatar());
            }
            memberVOs.add(vo);
        }

        TeamVO vo = new TeamVO();
        vo.setId(team.getId());
        vo.setName(team.getName());
        vo.setInviteCode(team.getInviteCode());
        vo.setOwnerId(team.getOwnerId());
        vo.setMemberCount(team.getMemberCount());
        vo.setCreateTime(team.getCreateTime());
        vo.setPriceFactor(readFactor());
        vo.setIAmOwner(team.getOwnerId().equals(userId));
        vo.setMembers(memberVOs);
        return vo;
    }

    @Override
    public List<Long> getTeamMemberIds(Long userId) {
        SysUserDO user = userMapper.selectById(userId);
        if (user == null || user.getTeamId() == null) {
            return List.of(userId);
        }
        List<Long> ids = teamMemberMapper.selectUserIdsByTeam(user.getTeamId());
        return ids.isEmpty() ? List.of(userId) : ids;
    }

    @Override
    public BigDecimal getPriceFactor(Long userId) {
        SysUserDO user = userMapper.selectById(userId);
        if (user == null || user.getTeamId() == null) {
            return BigDecimal.ONE;
        }
        return readFactor();
    }

    @Override
    public boolean isTeamAdminOf(Long operatorId, Long ownerUserId) {
        TeamMemberDO operator = findMembership(operatorId);
        if (operator == null || operator.getRole() == null || operator.getRole() != ROLE_ADMIN) {
            return false;
        }
        TeamMemberDO target = findMembership(ownerUserId);
        return target != null && operator.getTeamId().equals(target.getTeamId());
    }

    // ===== 内部辅助 =====

    private void assertNotInTeam(Long userId) {
        if (findMembership(userId) != null) {
            throw new BusinessException(ResultCode.BAD_REQUEST, "您已在一个团队中，请先退出");
        }
    }

    private TeamMemberDO findMembership(Long userId) {
        return teamMemberMapper.selectOne(new LambdaQueryWrapper<TeamMemberDO>()
                .eq(TeamMemberDO::getUserId, userId));
    }

    private void insertMember(Long teamId, Long userId, int role) {
        TeamMemberDO m = new TeamMemberDO();
        m.setTeamId(teamId);
        m.setUserId(userId);
        m.setRole(role);
        m.setDeleted(0);
        teamMemberMapper.insert(m);
    }

    private void setUserTeam(Long userId, Long teamId) {
        userMapper.update(null, new LambdaUpdateWrapper<SysUserDO>()
                .eq(SysUserDO::getId, userId)
                .set(SysUserDO::getTeamId, teamId));
    }

    private void bumpMemberCount(Long teamId, int delta) {
        teamMapper.update(null, new LambdaUpdateWrapper<TeamDO>()
                .eq(TeamDO::getId, teamId)
                .setSql("member_count = GREATEST(member_count + (" + delta + "), 0)"));
    }

    /** 全局加价系数，clamp≥1（永不比个人便宜）；读不到/非法回退默认 1.5 */
    private BigDecimal readFactor() {
        SysConfigDO config = configMapper.selectOne(new LambdaQueryWrapper<SysConfigDO>()
                .eq(SysConfigDO::getConfigKey, PRICE_FACTOR_KEY));
        BigDecimal factor = DEFAULT_FACTOR;
        if (config != null && StringUtils.hasText(config.getConfigValue())) {
            try {
                factor = new BigDecimal(config.getConfigValue().trim());
            } catch (NumberFormatException e) {
                log.warn("Invalid team.price.factor config '{}', using default {}", config.getConfigValue(), DEFAULT_FACTOR);
            }
        }
        return factor.compareTo(BigDecimal.ONE) < 0 ? BigDecimal.ONE : factor;
    }

    private String generateUniqueCode() {
        for (int attempt = 0; attempt < 5; attempt++) {
            StringBuilder sb = new StringBuilder(CODE_LEN);
            for (int i = 0; i < CODE_LEN; i++) {
                sb.append(CODE_ALPHABET[RANDOM.nextInt(CODE_ALPHABET.length)]);
            }
            String code = sb.toString();
            Long count = teamMapper.selectCount(new LambdaQueryWrapper<TeamDO>().eq(TeamDO::getInviteCode, code));
            if (count == null || count == 0) {
                return code;
            }
        }
        return IdUtil.fastSimpleUUID().substring(0, CODE_LEN).toUpperCase();
    }
}
