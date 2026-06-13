package com.tidecanvas.controller.admin;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.tidecanvas.common.Result;
import com.tidecanvas.mapper.AccessLogMapper;
import com.tidecanvas.mapper.LoginLogMapper;
import com.tidecanvas.model.entity.LoginLogDO;
import com.tidecanvas.model.vo.RedisInfoVO;
import com.tidecanvas.model.vo.SessionVO;
import com.tidecanvas.model.vo.SystemMetricsVO;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.redis.connection.RedisConnection;
import org.springframework.data.redis.connection.RedisConnectionFactory;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.io.File;
import java.lang.management.ManagementFactory;
import java.lang.management.MemoryUsage;
import java.net.NetworkInterface;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Enumeration;
import java.util.List;
import java.util.Properties;

/**
 * 管理后台 - 系统监控（服务器指标 / Redis / 在线会话）。
 *
 * @author tidecanvas
 */
@Slf4j
@Tag(name = "管理后台-系统监控")
@RestController
@RequestMapping("/api/admin/monitor")
@RequiredArgsConstructor
public class AdminMonitorController {

    private static final ZoneId BEIJING_ZONE = ZoneId.of("Asia/Shanghai");
    private static final DateTimeFormatter FMT = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss");

    private final RedisConnectionFactory redisConnectionFactory;
    private final AccessLogMapper accessLogMapper;
    private final LoginLogMapper loginLogMapper;

    @Operation(summary = "服务器系统指标")
    @GetMapping("/system")
    public Result<SystemMetricsVO> system() {
        SystemMetricsVO vo = new SystemMetricsVO();

        double cpuUsage = 0;
        double memUsage = 0;
        double maxDiskUsage = 0;

        try {
            com.sun.management.OperatingSystemMXBean os =
                    (com.sun.management.OperatingSystemMXBean) ManagementFactory.getOperatingSystemMXBean();
            double load = os.getCpuLoad();
            cpuUsage = (Double.isNaN(load) || load < 0) ? 0 : load * 100;
            vo.setCpuUsage(r1(cpuUsage));
            vo.setCpuCores(Runtime.getRuntime().availableProcessors());
            vo.setLoadAverage(r1(os.getSystemLoadAverage()));

            long totalMem = os.getTotalMemorySize();
            long freeMem = os.getFreeMemorySize();
            long usedMem = totalMem - freeMem;
            memUsage = totalMem > 0 ? usedMem * 100.0 / totalMem : 0;
            vo.setMemTotal(totalMem);
            vo.setMemUsed(usedMem);
            vo.setMemUsage(r1(memUsage));
        } catch (Exception e) {
            log.warn("采集 CPU/内存指标失败: {}", e.getMessage());
        }

        try {
            MemoryUsage heap = ManagementFactory.getMemoryMXBean().getHeapMemoryUsage();
            vo.setJvmHeapUsed(heap.getUsed());
            vo.setJvmHeapMax(heap.getMax());
            vo.setJvmHeapUsage(heap.getMax() > 0 ? r1(heap.getUsed() * 100.0 / heap.getMax()) : 0);
            vo.setPid(ProcessHandle.current().pid());
            vo.setUptimeMs(ManagementFactory.getRuntimeMXBean().getUptime());
        } catch (Exception e) {
            log.warn("采集 JVM 指标失败: {}", e.getMessage());
        }

        vo.setOsName(System.getProperty("os.name"));
        vo.setOsArch(System.getProperty("os.arch"));

        try {
            List<SystemMetricsVO.DiskVO> disks = new ArrayList<>();
            for (File root : File.listRoots()) {
                long total = root.getTotalSpace();
                if (total <= 0) {
                    continue;
                }
                long free = root.getUsableSpace();
                long used = total - free;
                double usage = total > 0 ? used * 100.0 / total : 0;
                maxDiskUsage = Math.max(maxDiskUsage, usage);
                disks.add(new SystemMetricsVO.DiskVO(root.getAbsolutePath(), total, free, used, r1(usage)));
            }
            vo.setDisks(disks);
        } catch (Exception e) {
            log.warn("采集磁盘指标失败: {}", e.getMessage());
            vo.setDisks(new ArrayList<>());
        }

        try {
            int nics = 0;
            Enumeration<NetworkInterface> en = NetworkInterface.getNetworkInterfaces();
            while (en != null && en.hasMoreElements()) {
                NetworkInterface ni = en.nextElement();
                if (ni.isUp() && !ni.isLoopback()) {
                    nics++;
                }
            }
            vo.setOnlineNics(nics);
        } catch (Exception e) {
            log.warn("采集网卡数失败: {}", e.getMessage());
        }

        try {
            String since = LocalDateTime.now(BEIJING_ZONE).minusDays(7).format(FMT);
            Long success = loginLogMapper.selectCount(new LambdaQueryWrapper<LoginLogDO>()
                    .eq(LoginLogDO::getStatus, 1).ge(LoginLogDO::getCreateTime, since));
            Long fail = loginLogMapper.selectCount(new LambdaQueryWrapper<LoginLogDO>()
                    .eq(LoginLogDO::getStatus, 0).ge(LoginLogDO::getCreateTime, since));
            long s = success != null ? success : 0;
            long f = fail != null ? fail : 0;
            vo.setAuthSuccess(s);
            vo.setAuthFail(f);
            vo.setAuthSuccessRate(s + f > 0 ? r1(s * 100.0 / (s + f)) : 100);
        } catch (Exception e) {
            log.warn("采集认证统计失败: {}", e.getMessage());
            vo.setAuthSuccessRate(100);
        }

        // 健康评分：CPU 40% + 内存 40% + 最高磁盘 20%，越空越高
        int health = (int) Math.round(100 - (cpuUsage * 0.4 + memUsage * 0.4 + maxDiskUsage * 0.2));
        vo.setHealthScore(Math.max(0, Math.min(100, health)));

        return Result.success(vo);
    }

    @Operation(summary = "Redis 监控信息")
    @GetMapping("/redis")
    public Result<RedisInfoVO> redis() {
        RedisInfoVO vo = new RedisInfoVO();
        try (RedisConnection conn = redisConnectionFactory.getConnection()) {
            Properties info = conn.serverCommands().info();
            Long dbSize = conn.serverCommands().dbSize();
            vo.setConnected(true);
            vo.setKeyCount(dbSize != null ? dbSize : 0);
            if (info != null) {
                long hits = parseLong(info.getProperty("keyspace_hits"));
                long misses = parseLong(info.getProperty("keyspace_misses"));
                vo.setHitRate(hits + misses > 0 ? r1(hits * 100.0 / (hits + misses)) : 0);
                vo.setVersion(info.getProperty("redis_version"));
                vo.setUptimeSeconds(parseLong(info.getProperty("uptime_in_seconds")));
                vo.setUsedMemoryHuman(info.getProperty("used_memory_human"));
            }
        } catch (Exception e) {
            log.warn("Redis 监控读取失败: {}", e.getMessage());
            vo.setConnected(false);
        }
        return Result.success(vo);
    }

    @Operation(summary = "最近在线会话")
    @GetMapping("/sessions")
    public Result<List<SessionVO>> sessions() {
        try {
            return Result.success(accessLogMapper.recentSessions(12));
        } catch (Exception e) {
            log.warn("查询在线会话失败: {}", e.getMessage());
            return Result.success(new ArrayList<>());
        }
    }

    private double r1(double v) {
        return Math.round(v * 10) / 10.0;
    }

    private long parseLong(String s) {
        try {
            return s == null ? 0 : Long.parseLong(s.trim());
        } catch (NumberFormatException e) {
            return 0;
        }
    }
}
