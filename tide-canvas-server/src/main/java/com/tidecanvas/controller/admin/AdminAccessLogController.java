package com.tidecanvas.controller.admin;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.tidecanvas.common.PageResult;
import com.tidecanvas.common.Result;
import com.tidecanvas.annotation.RequiresPermission;
import com.tidecanvas.mapper.AccessLogMapper;
import com.tidecanvas.model.entity.AccessLogDO;
import com.tidecanvas.model.query.AccessLogQuery;
import com.tidecanvas.model.vo.AccessLogVO;
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

@Tag(name = "管理后台-访问日志")
@RestController
@RequestMapping("/api/admin/access-logs")
@RequiredArgsConstructor
public class AdminAccessLogController {

    private final AccessLogMapper accessLogMapper;

    @Operation(summary = "访问日志列表")
    @RequiresPermission("accesslog:view")
    @GetMapping
    public Result<PageResult<AccessLogVO>> list(AccessLogQuery query) {
        Page<AccessLogDO> page = new Page<>(query.getPageNum(), query.getPageSize());
        LambdaQueryWrapper<AccessLogDO> wrapper = new LambdaQueryWrapper<AccessLogDO>()
                .eq(query.getUserId() != null, AccessLogDO::getUserId, query.getUserId())
                .like(StringUtils.hasText(query.getPath()), AccessLogDO::getPath, query.getPath())
                .and(StringUtils.hasText(query.getKeyword()), w -> w
                        .like(AccessLogDO::getUsername, query.getKeyword())
                        .or().like(AccessLogDO::getIp, query.getKeyword()))
                .ge(StringUtils.hasText(query.getStartTime()), AccessLogDO::getCreateTime, query.getStartTime())
                .le(StringUtils.hasText(query.getEndTime()), AccessLogDO::getCreateTime, query.getEndTime())
                .orderByDesc(AccessLogDO::getCreateTime);
        accessLogMapper.selectPage(page, wrapper);
        List<AccessLogVO> records = page.getRecords().stream().map(l -> {
            AccessLogVO vo = new AccessLogVO();
            BeanUtils.copyProperties(l, vo);
            return vo;
        }).toList();
        return Result.success(PageResult.of(records, page));
    }

    @Operation(summary = "删除访问日志")
    @RequiresPermission("accesslog:delete")
    @DeleteMapping("/{id}")
    public Result<Void> delete(@PathVariable Long id) {
        accessLogMapper.deleteById(id);
        return Result.success();
    }

    @Operation(summary = "清空全部访问日志")
    @RequiresPermission("accesslog:delete")
    @DeleteMapping
    public Result<Void> clear() {
        accessLogMapper.delete(null);
        return Result.success();
    }
}
