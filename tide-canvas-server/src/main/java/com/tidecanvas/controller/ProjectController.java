package com.tidecanvas.controller;

import com.tidecanvas.common.PageResult;
import com.tidecanvas.common.Result;
import com.tidecanvas.model.dto.CanvasSaveDTO;
import com.tidecanvas.model.dto.ProjectCreateDTO;
import com.tidecanvas.model.dto.ProjectUpdateDTO;
import com.tidecanvas.model.query.ProjectQuery;
import com.tidecanvas.model.vo.ProjectDetailVO;
import com.tidecanvas.model.vo.ProjectVO;
import com.tidecanvas.security.SecurityUtils;
import com.tidecanvas.service.ProjectService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

@Tag(name = "项目管理")
@RestController
@RequestMapping("/api/projects")
@RequiredArgsConstructor
public class ProjectController {

    private final ProjectService projectService;

    @Operation(summary = "项目列表")
    @GetMapping
    public Result<PageResult<ProjectVO>> list(ProjectQuery query) {
        Long userId = SecurityUtils.getCurrentUserId();
        return Result.success(projectService.listProjects(userId, query));
    }

    @Operation(summary = "创建项目")
    @PostMapping
    public Result<ProjectVO> create(@Valid @RequestBody ProjectCreateDTO dto) {
        Long userId = SecurityUtils.getCurrentUserId();
        return Result.success(projectService.createProject(userId, dto));
    }

    @Operation(summary = "项目详情")
    @GetMapping("/{id}")
    public Result<ProjectDetailVO> get(@PathVariable Long id) {
        Long userId = SecurityUtils.getCurrentUserId();
        return Result.success(projectService.getProject(userId, id));
    }

    @Operation(summary = "按 URL Token 获取项目详情")
    @GetMapping("/token/{token}")
    public Result<ProjectDetailVO> getByToken(@PathVariable String token) {
        Long userId = SecurityUtils.getCurrentUserId();
        return Result.success(projectService.getProjectByToken(userId, token));
    }

    @Operation(summary = "更新项目")
    @PutMapping("/{id}")
    public Result<ProjectVO> update(@PathVariable Long id, @Valid @RequestBody ProjectUpdateDTO dto) {
        Long userId = SecurityUtils.getCurrentUserId();
        return Result.success(projectService.updateProject(userId, id, dto));
    }

    @Operation(summary = "删除项目")
    @DeleteMapping("/{id}")
    public Result<Void> delete(@PathVariable Long id) {
        Long userId = SecurityUtils.getCurrentUserId();
        projectService.deleteProject(userId, id);
        return Result.success();
    }

    @Operation(summary = "保存画布数据")
    @PutMapping("/{id}/canvas")
    public Result<Void> saveCanvas(@PathVariable Long id, @Valid @RequestBody CanvasSaveDTO dto) {
        Long userId = SecurityUtils.getCurrentUserId();
        projectService.saveCanvas(userId, id, dto);
        return Result.success();
    }

    @Operation(summary = "获取画布数据")
    @GetMapping("/{id}/canvas")
    public Result<Map<String, String>> getCanvas(@PathVariable Long id) {
        Long userId = SecurityUtils.getCurrentUserId();
        String data = projectService.getCanvasData(userId, id);
        return Result.success(Map.of("canvasData", data));
    }

    @Operation(summary = "生成分享链接")
    @PostMapping("/{id}/share")
    public Result<Map<String, String>> share(@PathVariable Long id) {
        Long userId = SecurityUtils.getCurrentUserId();
        String token = projectService.shareProject(userId, id);
        return Result.success(Map.of("shareToken", token, "shareUrl", "/share/" + token));
    }
}
