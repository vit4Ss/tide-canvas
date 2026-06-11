package com.tidecanvas.controller;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.tidecanvas.common.PageResult;
import com.tidecanvas.common.Result;
import com.tidecanvas.mapper.AiGenerationLogMapper;
import com.tidecanvas.model.dto.AiGenerateDTO;
import com.tidecanvas.model.dto.GridSplitDTO;
import com.tidecanvas.model.entity.AiGenerationLogDO;
import com.tidecanvas.model.query.AiGenerationLogQuery;
import com.tidecanvas.model.query.AiTaskQuery;
import com.tidecanvas.model.vo.AiGenerationLogVO;
import com.tidecanvas.model.vo.AiHandlerVO;
import com.tidecanvas.model.vo.AiModelVO;
import com.tidecanvas.model.vo.AiTaskVO;
import com.tidecanvas.annotation.RateLimit;
import com.tidecanvas.annotation.LimitDimension;
import com.tidecanvas.security.SecurityUtils;
import com.tidecanvas.service.AiService;
import com.tidecanvas.service.ImageGridService;
import com.tidecanvas.service.TeamService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.beans.BeanUtils;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@Tag(name = "AI生成接口")
@RestController
@RequestMapping("/api/ai")
@RequiredArgsConstructor
public class AiController {

    private final AiService aiService;
    private final ImageGridService imageGridService;
    private final AiGenerationLogMapper logMapper;
    private final TeamService teamService;

    @Operation(summary = "统一生成入口")
    @RateLimit(name = "ai_generate", limit = 30, period = 60, dimension = LimitDimension.USER_AND_IP, banThreshold = 3, banSeconds = 600)
    @PostMapping("/generate")
    public Result<AiTaskVO> generate(@Valid @RequestBody AiGenerateDTO dto) {
        Long userId = SecurityUtils.getCurrentUserId();
        return Result.success(aiService.generate(userId, dto));
    }

    @Operation(summary = "图片宫格切分")
    @PostMapping("/grid-split")
    public Result<List<String>> gridSplit(@Valid @RequestBody GridSplitDTO dto) {
        return Result.success(imageGridService.split(dto));
    }

    @Operation(summary = "查询任务状态")
    @GetMapping("/tasks/{taskId}")
    public Result<AiTaskVO> getTask(@PathVariable Long taskId) {
        Long userId = SecurityUtils.getCurrentUserId();
        return Result.success(aiService.getTask(userId, taskId));
    }

    @Operation(summary = "取消任务")
    @DeleteMapping("/tasks/{taskId}")
    public Result<Void> cancelTask(@PathVariable Long taskId) {
        Long userId = SecurityUtils.getCurrentUserId();
        aiService.cancelTask(userId, taskId);
        return Result.success();
    }

    @Operation(summary = "我的任务列表")
    @GetMapping("/tasks")
    public Result<PageResult<AiTaskVO>> listTasks(AiTaskQuery query) {
        Long userId = SecurityUtils.getCurrentUserId();
        return Result.success(aiService.listTasks(userId, query));
    }

    @Operation(summary = "可用模型列表")
    @GetMapping("/models")
    public Result<List<AiModelVO>> listModels() {
        return Result.success(aiService.listModels());
    }

    @Operation(summary = "可用Handler列表")
    @GetMapping("/handlers")
    public Result<List<AiHandlerVO>> listHandlers() {
        return Result.success(aiService.listHandlers());
    }

    @Operation(summary = "本画布生成历史（当前用户，可按 projectId 过滤）")
    @GetMapping("/logs")
    public Result<PageResult<AiGenerationLogVO>> myLogs(AiGenerationLogQuery query) {
        Long userId = SecurityUtils.getCurrentUserId();
        Page<AiGenerationLogDO> page = new Page<>(query.getPageNum(), query.getPageSize());
        LambdaQueryWrapper<AiGenerationLogDO> wrapper = new LambdaQueryWrapper<AiGenerationLogDO>()
                .in(AiGenerationLogDO::getUserId, teamService.getTeamMemberIds(userId)) // 团队共享生成历史
                .eq(query.getProjectId() != null, AiGenerationLogDO::getProjectId, query.getProjectId())
                .orderByDesc(AiGenerationLogDO::getId);
        logMapper.selectPage(page, wrapper);
        List<AiGenerationLogVO> records = page.getRecords().stream().map(d -> {
            AiGenerationLogVO vo = new AiGenerationLogVO();
            BeanUtils.copyProperties(d, vo);
            return vo;
        }).toList();
        return Result.success(PageResult.of(records, page));
    }
}
