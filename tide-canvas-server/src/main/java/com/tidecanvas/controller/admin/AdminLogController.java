package com.tidecanvas.controller.admin;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.tidecanvas.common.PageResult;
import com.tidecanvas.common.Result;
import com.tidecanvas.annotation.RequiresPermission;
import com.tidecanvas.mapper.SysLogMapper;
import com.tidecanvas.model.entity.SysLogDO;
import com.tidecanvas.model.query.LogQuery;
import com.tidecanvas.model.vo.LogVO;
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

@Tag(name = "管理后台-操作日志")
@RestController
@RequestMapping("/api/admin/logs")
@RequiredArgsConstructor
public class AdminLogController {

    private final SysLogMapper logMapper;

    @Operation(summary = "日志列表")
    @RequiresPermission("syslog:view")
    @GetMapping
    public Result<PageResult<LogVO>> list(LogQuery query) {
        Page<SysLogDO> page = new Page<>(query.getPageNum(), query.getPageSize());
        LambdaQueryWrapper<SysLogDO> wrapper = new LambdaQueryWrapper<SysLogDO>()
                .eq(query.getUserId() != null, SysLogDO::getUserId, query.getUserId())
                .eq(StringUtils.hasText(query.getAction()), SysLogDO::getAction, query.getAction())
                .like(StringUtils.hasText(query.getKeyword()), SysLogDO::getDetail, query.getKeyword())
                .orderByDesc(SysLogDO::getCreateTime);
        logMapper.selectPage(page, wrapper);
        List<LogVO> records = page.getRecords().stream().map(l -> {
            LogVO vo = new LogVO();
            BeanUtils.copyProperties(l, vo);
            return vo;
        }).toList();
        return Result.success(PageResult.of(records, page));
    }

    @Operation(summary = "删除日志")
    @RequiresPermission("syslog:delete")
    @DeleteMapping("/{id}")
    public Result<Void> delete(@PathVariable Long id) {
        logMapper.deleteById(id);
        return Result.success();
    }

    @Operation(summary = "清空全部日志")
    @RequiresPermission("syslog:delete")
    @DeleteMapping
    public Result<Void> clear() {
        logMapper.delete(null);
        return Result.success();
    }
}
