package com.tidecanvas.service;

import com.tidecanvas.model.dto.RoleSaveDTO;
import com.tidecanvas.model.vo.RoleVO;

import java.util.List;
import java.util.Set;

/**
 * 管理角色（RBAC）服务。
 *
 * @author tidecanvas
 */
public interface AdminRoleService {

    List<RoleVO> listRoles();

    void createRole(RoleSaveDTO dto);

    void updateRole(Long id, RoleSaveDTO dto);

    void deleteRole(Long id);

    /** 某管理员的权限码集合；role_id 为空视为超级管理员(返回 {"*"}) */
    Set<String> getUserPermissions(Long userId);
}
