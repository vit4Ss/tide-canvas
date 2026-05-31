package com.tidecanvas.controller.admin;

import com.tidecanvas.common.Result;
import com.tidecanvas.mapper.*;
import com.tidecanvas.model.vo.DashboardOverviewVO;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@Slf4j
@Tag(name = "管理后台-数据面板")
@RestController
@RequestMapping("/api/admin/dashboard")
@RequiredArgsConstructor
public class AdminDashboardController {

    private final SysUserMapper userMapper;
    private final CanvasProjectMapper projectMapper;
    private final AiTaskMapper taskMapper;
    private final SysFileMapper fileMapper;

    @Operation(summary = "数据概览")
    @GetMapping("/overview")
    public Result<DashboardOverviewVO> overview() {
        DashboardOverviewVO vo = new DashboardOverviewVO();
        vo.setTotalUsers(userMapper.selectCount(null));
        vo.setTotalProjects(projectMapper.selectCount(null));
        vo.setTotalApiCalls(taskMapper.selectCount(null));
        try {
            vo.setTodayNewUsers(userMapper.countTodayNew());
        } catch (Exception e) {
            log.warn("查询今日新增用户失败", e);
            vo.setTodayNewUsers(0L);
        }
        try {
            vo.setActiveUsers(userMapper.countTodayActive());
        } catch (Exception e) {
            log.warn("查询活跃用户失败", e);
            vo.setActiveUsers(0L);
        }
        try {
            vo.setTodayApiCalls(taskMapper.countTodayCalls());
        } catch (Exception e) {
            log.warn("查询今日API调用失败", e);
            vo.setTodayApiCalls(0L);
        }
        try {
            Long storage = fileMapper.sumTotalStorage();
            vo.setTotalStorageBytes(storage != null ? storage : 0L);
        } catch (Exception e) {
            log.warn("查询总存储量失败", e);
            vo.setTotalStorageBytes(0L);
        }
        return Result.success(vo);
    }
}
