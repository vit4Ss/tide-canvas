package com.tidecanvas.controller;

import com.tidecanvas.common.Result;
import com.tidecanvas.model.vo.CheckinCalendarVO;
import com.tidecanvas.model.vo.CheckinStatusVO;
import com.tidecanvas.security.SecurityUtils;
import com.tidecanvas.service.CheckinService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.*;

/**
 * 签到接口
 *
 * @author tidecanvas
 */
@Tag(name = "每日签到")
@RestController
@RequestMapping("/api/checkin")
@RequiredArgsConstructor
public class CheckinController {

    private final CheckinService checkinService;

    @Operation(summary = "每日签到")
    @PostMapping
    public Result<CheckinStatusVO> checkin() {
        Long userId = SecurityUtils.getCurrentUserId();
        return Result.success(checkinService.checkin(userId));
    }

    @Operation(summary = "获取今日签到状态")
    @GetMapping("/status")
    public Result<CheckinStatusVO> getStatus() {
        Long userId = SecurityUtils.getCurrentUserId();
        return Result.success(checkinService.getStatus(userId));
    }

    @Operation(summary = "获取签到日历")
    @GetMapping("/calendar")
    public Result<CheckinCalendarVO> getCalendar(@RequestParam Integer year,
                                                  @RequestParam Integer month) {
        Long userId = SecurityUtils.getCurrentUserId();
        return Result.success(checkinService.getCalendar(userId, year, month));
    }
}
