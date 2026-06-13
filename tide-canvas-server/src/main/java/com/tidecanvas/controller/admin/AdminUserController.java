package com.tidecanvas.controller.admin;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.tidecanvas.common.PageResult;
import com.tidecanvas.common.Result;
import com.tidecanvas.common.ResultCode;
import com.tidecanvas.exception.BusinessException;
import com.tidecanvas.mapper.SysUserMapper;
import com.tidecanvas.annotation.OperateLog;
import com.tidecanvas.model.dto.AdminUserUpdateDTO;
import com.tidecanvas.model.entity.SysUserDO;
import com.tidecanvas.model.query.AdminUserQuery;
import com.tidecanvas.model.vo.UserVO;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.beans.BeanUtils;
import org.springframework.util.StringUtils;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@Tag(name = "管理后台-用户管理")
@RestController
@RequestMapping("/api/admin/users")
@RequiredArgsConstructor
public class AdminUserController {

    private final SysUserMapper userMapper;

    @Operation(summary = "用户列表")
    @GetMapping
    public Result<PageResult<UserVO>> list(AdminUserQuery query) {
        Page<SysUserDO> page = new Page<>(query.getPageNum(), query.getPageSize());
        LambdaQueryWrapper<SysUserDO> wrapper = new LambdaQueryWrapper<SysUserDO>()
                // 关键词匹配 用户名/邮箱/昵称（前端提示「搜索用户名、邮箱」），用 and 包裹 or 避免与角色/状态条件串联
                .and(StringUtils.hasText(query.getKeyword()), w -> w
                        .like(SysUserDO::getUsername, query.getKeyword())
                        .or().like(SysUserDO::getEmail, query.getKeyword())
                        .or().like(SysUserDO::getNickname, query.getKeyword()))
                .eq(query.getRole() != null, SysUserDO::getRole, query.getRole())
                .eq(query.getStatus() != null, SysUserDO::getStatus, query.getStatus())
                .orderByDesc(SysUserDO::getCreateTime);
        userMapper.selectPage(page, wrapper);
        List<UserVO> records = page.getRecords().stream().map(u -> {
            UserVO vo = new UserVO();
            BeanUtils.copyProperties(u, vo);
            return vo;
        }).toList();
        return Result.success(PageResult.of(records, page));
    }

    @Operation(summary = "用户详情")
    @GetMapping("/{id}")
    public Result<UserVO> get(@PathVariable Long id) {
        SysUserDO user = userMapper.selectById(id);
        if (user == null) {
            throw new BusinessException(ResultCode.NOT_FOUND, "用户不存在");
        }
        UserVO vo = new UserVO();
        BeanUtils.copyProperties(user, vo);
        return Result.success(vo);
    }

    @Operation(summary = "编辑用户")
    @OperateLog(action = "编辑用户", target = "用户管理")
    @PutMapping("/{id}")
    public Result<Void> update(@PathVariable Long id, @Valid @RequestBody AdminUserUpdateDTO dto) {
        SysUserDO user = userMapper.selectById(id);
        if (user == null) {
            throw new BusinessException(ResultCode.NOT_FOUND, "用户不存在");
        }
        if (dto.getRole() != null) {
            user.setRole(dto.getRole());
        }
        if (dto.getStatus() != null) {
            user.setStatus(dto.getStatus());
        }
        if (dto.getApiQuota() != null) {
            user.setApiQuota(dto.getApiQuota());
        }
        if (dto.getStorageQuota() != null) {
            user.setStorageQuota(dto.getStorageQuota());
        }
        userMapper.updateById(user);
        return Result.success();
    }
}
