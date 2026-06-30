package com.tidecanvas.controller.admin;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.tidecanvas.common.PageResult;
import com.tidecanvas.common.Result;
import com.tidecanvas.annotation.RequiresPermission;
import com.tidecanvas.annotation.OperateLog;
import com.tidecanvas.mapper.CanvasProjectMapper;
import com.tidecanvas.model.entity.CanvasProjectDO;
import com.tidecanvas.model.vo.ProjectVO;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import org.springframework.beans.BeanUtils;
import org.springframework.util.StringUtils;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@Tag(name = "管理后台-内容管理")
@RestController
@RequestMapping("/api/admin/contents")
@RequiredArgsConstructor
public class AdminContentController {

    private final CanvasProjectMapper projectMapper;

    @Operation(summary = "内容列表")
    @RequiresPermission("content:view")
    @GetMapping
    public Result<PageResult<ProjectVO>> list(
            @RequestParam(defaultValue = "1") Integer pageNum,
            @RequestParam(defaultValue = "20") Integer pageSize,
            @RequestParam(required = false) String keyword,
            @RequestParam(required = false) Integer status) {
        Page<CanvasProjectDO> page = new Page<>(pageNum, pageSize);
        LambdaQueryWrapper<CanvasProjectDO> wrapper = new LambdaQueryWrapper<CanvasProjectDO>()
                .eq(CanvasProjectDO::getIsPublic, 1)
                .like(StringUtils.hasText(keyword), CanvasProjectDO::getName, keyword)
                .eq(status != null, CanvasProjectDO::getStatus, status)
                .orderByDesc(CanvasProjectDO::getCreateTime);
        projectMapper.selectPage(page, wrapper);
        List<ProjectVO> records = page.getRecords().stream().map(p -> {
            ProjectVO vo = new ProjectVO();
            BeanUtils.copyProperties(p, vo);
            vo.setIsPublic(p.getIsPublic() == 1);
            return vo;
        }).toList();
        return Result.success(PageResult.of(records, page));
    }

    @Operation(summary = "审核内容")
    @RequiresPermission("content:audit")
    @OperateLog(action = "审核内容", target = "内容管理")
    @PutMapping("/{id}")
    public Result<Void> audit(@PathVariable Long id, @RequestBody Map<String, Integer> body) {
        CanvasProjectDO project = projectMapper.selectById(id);
        if (project != null && body.containsKey("status")) {
            project.setStatus(body.get("status"));
            projectMapper.updateById(project);
        }
        return Result.success();
    }
}
