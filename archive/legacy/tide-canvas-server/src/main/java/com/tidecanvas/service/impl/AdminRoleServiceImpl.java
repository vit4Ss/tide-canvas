package com.tidecanvas.service.impl;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.tidecanvas.common.ResultCode;
import com.tidecanvas.constant.AdminPermissions;
import com.tidecanvas.exception.BusinessException;
import com.tidecanvas.mapper.SysRoleMapper;
import com.tidecanvas.mapper.SysUserMapper;
import com.tidecanvas.model.dto.RoleSaveDTO;
import com.tidecanvas.model.entity.SysRoleDO;
import com.tidecanvas.model.entity.SysUserDO;
import com.tidecanvas.model.vo.RoleVO;
import com.tidecanvas.service.AdminRoleService;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;

import java.util.Arrays;
import java.util.List;
import java.util.Set;

/**
 * 管理角色服务实现。
 *
 * @author tidecanvas
 */
@Service
@RequiredArgsConstructor
public class AdminRoleServiceImpl implements AdminRoleService {

    private final SysRoleMapper roleMapper;
    private final SysUserMapper userMapper;

    private static final String SUPER_CODE = "super";

    @Override
    public List<RoleVO> listRoles() {
        return roleMapper.selectList(new LambdaQueryWrapper<SysRoleDO>()
                        .orderByAsc(SysRoleDO::getId))
                .stream().map(this::toVO).toList();
    }

    @Override
    public void createRole(RoleSaveDTO dto) {
        if (existsCode(dto.getCode(), null)) {
            throw new BusinessException(ResultCode.BAD_REQUEST, "角色编码已存在");
        }
        SysRoleDO role = new SysRoleDO();
        role.setName(dto.getName());
        role.setCode(dto.getCode());
        role.setPermissions(normalizePermissions(dto.getPermissions()));
        role.setBuiltin(0);
        role.setRemark(dto.getRemark());
        role.setDeleted(0);
        roleMapper.insert(role);
    }

    @Override
    public void updateRole(Long id, RoleSaveDTO dto) {
        SysRoleDO role = roleMapper.selectById(id);
        if (role == null) {
            throw new BusinessException(ResultCode.NOT_FOUND, "角色不存在");
        }
        boolean builtin = role.getBuiltin() != null && role.getBuiltin() == 1;
        // 内置角色不可改编码；超级管理员权限恒为 *
        if (!builtin && existsCode(dto.getCode(), id)) {
            throw new BusinessException(ResultCode.BAD_REQUEST, "角色编码已存在");
        }
        role.setName(dto.getName());
        if (!builtin) {
            role.setCode(dto.getCode());
        }
        if (SUPER_CODE.equals(role.getCode())) {
            role.setPermissions(AdminPermissions.WILDCARD);
        } else {
            role.setPermissions(normalizePermissions(dto.getPermissions()));
        }
        role.setRemark(dto.getRemark());
        roleMapper.updateById(role);
    }

    @Override
    public void deleteRole(Long id) {
        SysRoleDO role = roleMapper.selectById(id);
        if (role == null) {
            throw new BusinessException(ResultCode.NOT_FOUND, "角色不存在");
        }
        if (role.getBuiltin() != null && role.getBuiltin() == 1) {
            throw new BusinessException(ResultCode.BAD_REQUEST, "内置角色不可删除");
        }
        Long assigned = userMapper.selectCount(new LambdaQueryWrapper<SysUserDO>().eq(SysUserDO::getRoleId, id));
        if (assigned != null && assigned > 0) {
            throw new BusinessException(ResultCode.BAD_REQUEST, "该角色下仍有管理员，请先改派后再删除");
        }
        roleMapper.deleteById(id);
    }

    @Override
    public Set<String> getUserPermissions(Long userId) {
        if (userId == null) {
            return Set.of();
        }
        SysUserDO user = userMapper.selectById(userId);
        // 未分配角色（含存量管理员）视为超级管理员，避免被锁死
        if (user == null || user.getRoleId() == null) {
            return Set.of(AdminPermissions.WILDCARD);
        }
        SysRoleDO role = roleMapper.selectById(user.getRoleId());
        if (role == null || !StringUtils.hasText(role.getPermissions())) {
            return Set.of();
        }
        if (AdminPermissions.WILDCARD.equals(role.getPermissions().trim())) {
            return Set.of(AdminPermissions.WILDCARD);
        }
        return Arrays.stream(role.getPermissions().split(","))
                .map(String::trim)
                .filter(StringUtils::hasText)
                .collect(java.util.stream.Collectors.toUnmodifiableSet());
    }

    private boolean existsCode(String code, Long excludeId) {
        Long c = roleMapper.selectCount(new LambdaQueryWrapper<SysRoleDO>()
                .eq(SysRoleDO::getCode, code)
                .ne(excludeId != null, SysRoleDO::getId, excludeId));
        return c != null && c > 0;
    }

    /** 过滤为合法权限码并拼成 CSV */
    private String normalizePermissions(List<String> permissions) {
        if (permissions == null || permissions.isEmpty()) {
            return "";
        }
        return permissions.stream()
                .filter(AdminPermissions.ALL_CODES::contains)
                .distinct()
                .collect(java.util.stream.Collectors.joining(","));
    }

    private RoleVO toVO(SysRoleDO role) {
        RoleVO vo = new RoleVO();
        vo.setId(role.getId());
        vo.setName(role.getName());
        vo.setCode(role.getCode());
        vo.setBuiltin(role.getBuiltin());
        vo.setRemark(role.getRemark());
        vo.setCreateTime(role.getCreateTime());
        vo.setUpdateTime(role.getUpdateTime());
        String p = role.getPermissions();
        if (AdminPermissions.WILDCARD.equals(p == null ? null : p.trim())) {
            vo.setPermissions(List.of(AdminPermissions.WILDCARD));
        } else if (StringUtils.hasText(p)) {
            vo.setPermissions(Arrays.stream(p.split(",")).map(String::trim).filter(StringUtils::hasText).toList());
        } else {
            vo.setPermissions(List.of());
        }
        return vo;
    }
}
