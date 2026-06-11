package com.tidecanvas.controller;

import com.tidecanvas.annotation.LimitDimension;
import com.tidecanvas.annotation.RateLimit;
import com.tidecanvas.common.Result;
import com.tidecanvas.model.dto.TeamCreateDTO;
import com.tidecanvas.model.dto.TeamJoinDTO;
import com.tidecanvas.model.vo.TeamVO;
import com.tidecanvas.security.SecurityUtils;
import com.tidecanvas.service.TeamService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.*;

@Tag(name = "团队管理")
@RestController
@RequestMapping("/api/teams")
@RequiredArgsConstructor
public class TeamController {

    private final TeamService teamService;

    @Operation(summary = "我的团队（不在团队返回 null）")
    @GetMapping("/me")
    public Result<TeamVO> myTeam() {
        return Result.success(teamService.getMyTeam(SecurityUtils.getCurrentUserId()));
    }

    @Operation(summary = "创建团队")
    @PostMapping
    public Result<TeamVO> create(@Valid @RequestBody TeamCreateDTO dto) {
        return Result.success(teamService.createTeam(SecurityUtils.getCurrentUserId(), dto));
    }

    @Operation(summary = "凭邀请码加入团队")
    @RateLimit(name = "team_join", limit = 10, period = 60, dimension = LimitDimension.USER, banThreshold = 5, banSeconds = 600)
    @PostMapping("/join")
    public Result<TeamVO> join(@Valid @RequestBody TeamJoinDTO dto) {
        return Result.success(teamService.joinByCode(SecurityUtils.getCurrentUserId(), dto));
    }

    @Operation(summary = "退出团队（管理员需先解散）")
    @PostMapping("/leave")
    public Result<Void> leave() {
        teamService.leaveTeam(SecurityUtils.getCurrentUserId());
        return Result.success();
    }

    @Operation(summary = "解散团队（仅管理员）")
    @PostMapping("/disband")
    public Result<Void> disband() {
        teamService.disband(SecurityUtils.getCurrentUserId());
        return Result.success();
    }

    @Operation(summary = "移除成员（仅管理员）")
    @DeleteMapping("/members/{userId}")
    public Result<Void> removeMember(@PathVariable Long userId) {
        teamService.removeMember(SecurityUtils.getCurrentUserId(), userId);
        return Result.success();
    }
}
