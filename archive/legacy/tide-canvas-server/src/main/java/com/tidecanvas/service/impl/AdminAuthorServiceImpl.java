package com.tidecanvas.service.impl;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.tidecanvas.common.PageResult;
import com.tidecanvas.common.ResultCode;
import com.tidecanvas.exception.BusinessException;
import com.tidecanvas.mapper.SysUserMapper;
import com.tidecanvas.model.entity.SysUserDO;
import com.tidecanvas.model.query.AdminUserQuery;
import com.tidecanvas.model.vo.UserVO;
import com.tidecanvas.service.AdminAuthorService;
import lombok.RequiredArgsConstructor;
import org.springframework.beans.BeanUtils;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;

import java.util.List;

@Service
@RequiredArgsConstructor
public class AdminAuthorServiceImpl implements AdminAuthorService {

    private final SysUserMapper userMapper;

    @Override
    public PageResult<UserVO> listAuthors(AdminUserQuery query) {
        Page<SysUserDO> page = new Page<>(query.getPageNum(), query.getPageSize());
        LambdaQueryWrapper<SysUserDO> wrapper = new LambdaQueryWrapper<SysUserDO>()
                .eq(SysUserDO::getIsAuthor, 1)
                .like(StringUtils.hasText(query.getKeyword()), SysUserDO::getUsername, query.getKeyword())
                .orderByDesc(SysUserDO::getCreateTime);
        userMapper.selectPage(page, wrapper);
        List<UserVO> records = page.getRecords().stream().map(u -> {
            UserVO vo = new UserVO();
            BeanUtils.copyProperties(u, vo);
            return vo;
        }).toList();
        return PageResult.of(records, page);
    }

    @Override
    public void grantAuthor(Long userId) {
        SysUserDO user = userMapper.selectById(userId);
        if (user == null) {
            throw new BusinessException(ResultCode.NOT_FOUND, "用户不存在");
        }
        user.setIsAuthor(1);
        userMapper.updateById(user);
    }

    @Override
    public void revokeAuthor(Long userId) {
        SysUserDO user = userMapper.selectById(userId);
        if (user == null) {
            throw new BusinessException(ResultCode.NOT_FOUND, "用户不存在");
        }
        user.setIsAuthor(0);
        userMapper.updateById(user);
    }
}
