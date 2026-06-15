package com.tidecanvas.controller.admin;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.tidecanvas.common.PageResult;
import com.tidecanvas.common.Result;
import com.tidecanvas.annotation.RequiresPermission;
import com.tidecanvas.mapper.LoginLogMapper;
import com.tidecanvas.model.entity.LoginLogDO;
import com.tidecanvas.model.query.LoginLogQuery;
import com.tidecanvas.model.vo.LoginLogVO;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import org.springframework.beans.BeanUtils;
import org.springframework.util.StringUtils;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@Tag(name = "管理后台-登录日志")
@RestController
@RequestMapping("/api/admin/login-logs")
@RequiredArgsConstructor
public class AdminLoginLogController {

    private final LoginLogMapper loginLogMapper;

    @Operation(summary = "登录日志列表")
    @RequiresPermission("loginlog:view")
    @GetMapping
    public Result<PageResult<LoginLogVO>> list(LoginLogQuery query) {
        Page<LoginLogDO> page = new Page<>(query.getPageNum(), query.getPageSize());
        LambdaQueryWrapper<LoginLogDO> wrapper = new LambdaQueryWrapper<LoginLogDO>()
                .eq(query.getStatus() != null, LoginLogDO::getStatus, query.getStatus())
                .and(StringUtils.hasText(query.getKeyword()), w -> w
                        .like(LoginLogDO::getUsername, query.getKeyword())
                        .or().like(LoginLogDO::getIp, query.getKeyword()))
                .ge(StringUtils.hasText(query.getStartTime()), LoginLogDO::getCreateTime, query.getStartTime())
                .le(StringUtils.hasText(query.getEndTime()), LoginLogDO::getCreateTime, query.getEndTime())
                .orderByDesc(LoginLogDO::getCreateTime);
        loginLogMapper.selectPage(page, wrapper);
        List<LoginLogVO> records = page.getRecords().stream().map(l -> {
            LoginLogVO vo = new LoginLogVO();
            BeanUtils.copyProperties(l, vo);
            return vo;
        }).toList();
        return Result.success(PageResult.of(records, page));
    }

    @Operation(summary = "删除登录日志")
    @RequiresPermission("loginlog:delete")
    @DeleteMapping("/{id}")
    public Result<Void> delete(@PathVariable Long id) {
        loginLogMapper.deleteById(id);
        return Result.success();
    }

    @Operation(summary = "清空全部登录日志")
    @RequiresPermission("loginlog:delete")
    @DeleteMapping
    public Result<Void> clear() {
        loginLogMapper.delete(null);
        return Result.success();
    }
}
