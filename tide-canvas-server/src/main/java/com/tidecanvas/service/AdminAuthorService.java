package com.tidecanvas.service;

import com.tidecanvas.common.PageResult;
import com.tidecanvas.model.query.AdminUserQuery;
import com.tidecanvas.model.vo.UserVO;

/**
 * 管理后台作者服务接口
 *
 * @author tidecanvas
 */
public interface AdminAuthorService {

    /**
     * 分页查询作者列表（isAuthor=1的用户）
     *
     * @param query 查询条件
     * @return 分页结果
     */
    PageResult<UserVO> listAuthors(AdminUserQuery query);

    /**
     * 授予用户作者权限
     *
     * @param userId 用户ID
     */
    void grantAuthor(Long userId);

    /**
     * 撤销用户作者权限
     *
     * @param userId 用户ID
     */
    void revokeAuthor(Long userId);
}
