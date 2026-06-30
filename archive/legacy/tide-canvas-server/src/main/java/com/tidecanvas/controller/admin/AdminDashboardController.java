package com.tidecanvas.controller.admin;

import com.tidecanvas.common.Result;
import com.tidecanvas.annotation.RequiresPermission;
import com.tidecanvas.mapper.*;
import com.tidecanvas.model.entity.AiHandlerConfigDO;
import com.tidecanvas.model.vo.ActiveUserVO;
import com.tidecanvas.model.vo.DashboardChartsVO;
import com.tidecanvas.model.vo.DashboardOverviewVO;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.util.StringUtils;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.function.Supplier;
import java.util.stream.Collectors;

@Slf4j
@Tag(name = "管理后台-数据面板")
@RestController
@RequestMapping("/api/admin/dashboard")
@RequiredArgsConstructor
public class AdminDashboardController {

    private static final DateTimeFormatter DAY_LABEL = DateTimeFormatter.ofPattern("MM/dd");
    /** 趋势图天数(含今天) */
    private static final int TREND_DAYS = 7;
    /** AI 调用分布最多展示的类目数,其余合并为"其他" */
    private static final int DISTRIBUTION_TOP = 5;

    private final SysUserMapper userMapper;
    private final CanvasProjectMapper projectMapper;
    private final AiTaskMapper taskMapper;
    private final SysFileMapper fileMapper;
    private final AiHandlerConfigMapper handlerConfigMapper;
    private final AccessLogMapper accessLogMapper;
    private final LoginLogMapper loginLogMapper;

    @Operation(summary = "数据概览")
    @RequiresPermission("dashboard:view")
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
            vo.setTodayNewProjects(projectMapper.countTodayNew());
        } catch (Exception e) {
            log.warn("查询今日新建项目失败", e);
            vo.setTodayNewProjects(0L);
        }
        try {
            Long storage = fileMapper.sumTotalStorage();
            vo.setTotalStorageBytes(storage != null ? storage : 0L);
        } catch (Exception e) {
            log.warn("查询总存储量失败", e);
            vo.setTotalStorageBytes(0L);
        }
        try {
            vo.setTodayVisits(nz(accessLogMapper.countTodayPv()));
            vo.setTodayVisitors(nz(accessLogMapper.countTodayUv()));
        } catch (Exception e) {
            log.warn("查询今日访问量失败", e);
            vo.setTodayVisits(0L);
            vo.setTodayVisitors(0L);
        }
        try {
            vo.setTodayLogins(nz(loginLogMapper.countTodayLogins()));
        } catch (Exception e) {
            log.warn("查询今日登录数失败", e);
            vo.setTodayLogins(0L);
        }
        try {
            LocalDate today = LocalDate.now();
            vo.setActiveWeek(nz(userMapper.countActiveSince(today.minusDays(6) + " 00:00:00")));
            vo.setActiveMonth(nz(userMapper.countActiveSince(today.minusDays(29) + " 00:00:00")));
        } catch (Exception e) {
            log.warn("查询活跃用户(周/月)失败", e);
            vo.setActiveWeek(0L);
            vo.setActiveMonth(0L);
        }
        return Result.success(vo);
    }

    @Operation(summary = "图表数据(近7天趋势/AI调用分布/模型排行)")
    @RequiresPermission("dashboard:view")
    @GetMapping("/charts")
    public Result<DashboardChartsVO> charts() {
        LocalDate today = LocalDate.now();
        LocalDate startDay = today.minusDays(TREND_DAYS - 1L);
        String start = startDay + " 00:00:00";
        String end = today + " 23:59:59";

        Map<String, Long> newUsersByDay = toDateCountMap(userMapper.countByDateRange(start, end));
        Map<String, Long> activeUsersByDay = toDateCountMap(userMapper.countActiveByDateRange(start, end));
        Map<String, Long> projectsByDay = toDateCountMap(projectMapper.countByDateRange(start, end));
        Map<String, Long> aiCallsByDay = toDateCountMap(taskMapper.countByDateRange(start, end));
        Map<String, Long> pvByDay = safeDateCountMap(() -> accessLogMapper.pvByDateRange(start, end));
        Map<String, Long> uvByDay = safeDateCountMap(() -> accessLogMapper.uvByDateRange(start, end));
        Map<String, Long> loginByDay = safeDateCountMap(() -> loginLogMapper.loginByDateRange(start, end));

        // 逐日补零,保证图表横轴连续
        List<DashboardChartsVO.DailyTrendVO> userTrend = new ArrayList<>();
        List<DashboardChartsVO.DailyCreationVO> dailyCreation = new ArrayList<>();
        List<DashboardChartsVO.DailyVisitVO> visitTrend = new ArrayList<>();
        List<DashboardChartsVO.DailyCountVO> loginTrend = new ArrayList<>();
        for (int i = 0; i < TREND_DAYS; i++) {
            LocalDate day = startDay.plusDays(i);
            String key = day.toString();
            String label = day.format(DAY_LABEL);
            userTrend.add(new DashboardChartsVO.DailyTrendVO(label,
                    newUsersByDay.getOrDefault(key, 0L), activeUsersByDay.getOrDefault(key, 0L)));
            dailyCreation.add(new DashboardChartsVO.DailyCreationVO(label,
                    projectsByDay.getOrDefault(key, 0L), aiCallsByDay.getOrDefault(key, 0L)));
            visitTrend.add(new DashboardChartsVO.DailyVisitVO(label,
                    pvByDay.getOrDefault(key, 0L), uvByDay.getOrDefault(key, 0L)));
            loginTrend.add(new DashboardChartsVO.DailyCountVO(label, loginByDay.getOrDefault(key, 0L)));
        }

        DashboardChartsVO vo = new DashboardChartsVO();
        vo.setUserTrend(userTrend);
        vo.setDailyCreation(dailyCreation);
        vo.setAiDistribution(buildAiDistribution());
        vo.setModelUsage(buildModelUsage());
        vo.setVisitTrend(visitTrend);
        vo.setLoginTrend(loginTrend);
        return Result.success(vo);
    }

    @Operation(summary = "最近活跃用户")
    @RequiresPermission("dashboard:view")
    @GetMapping("/active-users")
    public Result<List<ActiveUserVO>> activeUsers() {
        try {
            return Result.success(userMapper.selectActiveUsers(10));
        } catch (Exception e) {
            log.warn("查询活跃用户列表失败", e);
            return Result.success(new ArrayList<>());
        }
    }

    /**
     * AI 调用分布:handler 标识映射为后台配置的显示名,Top5 之外合并为"其他"
     */
    private List<DashboardChartsVO.NameValueVO> buildAiDistribution() {
        Map<String, String> displayNames = handlerConfigMapper.selectList(null).stream()
                .collect(Collectors.toMap(AiHandlerConfigDO::getHandlerName,
                        c -> StringUtils.hasText(c.getDisplayName()) ? c.getDisplayName() : c.getHandlerName(),
                        (a, b) -> a));

        List<DashboardChartsVO.NameValueVO> result = new ArrayList<>();
        long others = 0;
        List<Map<String, Object>> rows = taskMapper.countByHandler();
        for (int i = 0; i < rows.size(); i++) {
            String handler = String.valueOf(rows.get(i).get("handlerName"));
            long count = readCount(rows.get(i), "count");
            if (i < DISTRIBUTION_TOP) {
                result.add(new DashboardChartsVO.NameValueVO(
                        displayNames.getOrDefault(handler, handler), count));
            } else {
                others += count;
            }
        }
        if (others > 0) {
            result.add(new DashboardChartsVO.NameValueVO("其他", others));
        }
        return result;
    }

    private List<DashboardChartsVO.NameValueVO> buildModelUsage() {
        return taskMapper.modelUsageRank(5).stream()
                .map(row -> {
                    Object name = row.get("modelName");
                    return new DashboardChartsVO.NameValueVO(
                            name != null ? name.toString() : "未知模型", readCount(row, "callCount"));
                })
                .collect(Collectors.toList());
    }

    private long nz(Long value) {
        return value != null ? value : 0L;
    }

    /** 包一层 try/catch：迁移前 access_log/login_log 表可能尚未建,聚合失败时返回空 map 不影响整体面板 */
    private Map<String, Long> safeDateCountMap(Supplier<List<Map<String, Object>>> supplier) {
        try {
            return toDateCountMap(supplier.get());
        } catch (Exception e) {
            log.warn("查询每日趋势失败", e);
            return new HashMap<>();
        }
    }

    private Map<String, Long> toDateCountMap(List<Map<String, Object>> rows) {
        return rows.stream()
                .filter(row -> row.get("date") != null)
                .collect(Collectors.toMap(
                        row -> row.get("date").toString(),
                        row -> readCount(row, "count"),
                        Long::sum,
                        HashMap::new));
    }

    private long readCount(Map<String, Object> row, String key) {
        Object value = row.get(key);
        return value instanceof Number number ? number.longValue() : 0L;
    }
}
