package monitor

import (
	"context"
	"math"
	"os"
	"runtime"
	"strconv"
	"strings"
	"time"

	"github.com/redis/go-redis/v9"
	"github.com/shirou/gopsutil/v3/cpu"
	"github.com/shirou/gopsutil/v3/disk"
	"github.com/shirou/gopsutil/v3/host"
	"github.com/shirou/gopsutil/v3/load"
	"github.com/shirou/gopsutil/v3/mem"
	gopsnet "github.com/shirou/gopsutil/v3/net"
	"github.com/sirupsen/logrus"
)

// startTime 进程启动时刻，用于计算 uptimeMs。包级变量在进程加载时即固定（不依赖 init 顺序）。
var startTime = time.Now()

// 采集参数。
const (
	// authStatDays 认证统计回看天数（近 7 天 login_log）。
	authStatDays = 7
	// sessionWindow 近期在线会话回看窗口（近 15 分钟 access_log）。
	sessionWindow = 15 * time.Minute
	// sessionLimit 在线会话返回条数上限。
	sessionLimit = 50
	// cpuSampleInterval CPU 采样间隔（0 表示自上次调用以来的瞬时值，不阻塞）。
	cpuSampleInterval = 0
	// sessionTimeLayout 会话最后活跃时间格式（前端 toMs 用 s.replace(" ","T") 解析，故用空格分隔）。
	sessionTimeLayout = "2006-01-02 15:04:05"
)

// Service 监控业务：聚合主机指标(gopsutil) + 认证统计(login_log) + Redis 状态 + 在线会话(access_log)。
type Service struct {
	repo   *Repository
	rdb    *redis.Client // 可为 nil（未配置 Redis）
	logger *logrus.Logger
}

// NewService 构造。rdb 可为 nil；logger 可为 nil。
func NewService(repo *Repository, rdb *redis.Client, logger *logrus.Logger) *Service {
	return &Service{repo: repo, rdb: rdb, logger: logger}
}

// SystemMetrics 采集系统运行指标。每项采集独立容错：单项失败回退 0/空，绝不让整个接口 500
// （对齐 log 模块 Stats 的 safeCount 思路）。
func (s *Service) SystemMetrics() *SystemMetricsVO {
	vo := &SystemMetricsVO{
		Disks:  []DiskVO{}, // 永不为 null（前端 sys.disks?.[0] 仍安全，但显式空切片更稳）
		OsArch: runtime.GOARCH,
		Pid:    os.Getpid(),
	}

	// CPU 使用率（瞬时；interval=0 取自上次调用以来的平均，首次可能为 0）。
	if pcts, err := cpu.Percent(cpuSampleInterval, false); err == nil && len(pcts) > 0 {
		vo.CPUUsage = clampPct(pcts[0])
	} else if err != nil {
		s.warn("采集CPU使用率失败: %v", err)
	}
	// CPU 逻辑核数。
	if n, err := cpu.Counts(true); err == nil {
		vo.CPUCores = n
	} else {
		vo.CPUCores = runtime.NumCPU() // 回退 runtime
		s.warn("采集CPU核数失败(回退runtime): %v", err)
	}
	// 1 分钟负载（Windows 通常取不到 → 回退 0）。
	if avg, err := load.Avg(); err == nil && avg != nil {
		vo.LoadAverage = round1(avg.Load1)
	}

	// 内存。
	if vm, err := mem.VirtualMemory(); err == nil && vm != nil {
		vo.MemTotal = vm.Total
		vo.MemUsed = vm.Used
		vo.MemUsage = clampPct(vm.UsedPercent)
	} else if err != nil {
		s.warn("采集内存失败: %v", err)
	}

	// JVM 堆：Go 无 JVM，用 runtime.MemStats 近似（HeapAlloc→used，HeapSys→max）。
	var ms runtime.MemStats
	runtime.ReadMemStats(&ms)
	vo.JvmHeapUsed = ms.HeapAlloc
	vo.JvmHeapMax = ms.HeapSys
	vo.JvmHeapUsage = ratioPct(ms.HeapAlloc, ms.HeapSys)

	// 磁盘：遍历物理分区，逐个取使用率（单分区失败仅跳过）。
	vo.Disks = s.collectDisks()

	// 在线网卡：up 且非 loopback 的接口数。
	vo.OnlineNics = s.countOnlineNics()

	// 操作系统名：host.Info 优先，失败回退 runtime.GOOS。
	if info, err := host.Info(); err == nil && info != nil {
		vo.OsName = osDisplayName(info)
	} else {
		vo.OsName = runtime.GOOS
		if err != nil {
			s.warn("采集主机信息失败(回退GOOS): %v", err)
		}
	}

	// 运行时长（进程启动至今）。
	vo.UptimeMs = time.Since(startTime).Milliseconds()

	// 认证统计（近 7 天 login_log）。
	s.fillAuthStats(vo)

	// 健康评分：100 - cpu*0.5 - mem*0.5，clamp [0,100]。
	vo.HealthScore = clampScore(100 - float64(vo.CPUUsage)*0.5 - float64(vo.MemUsage)*0.5)

	return vo
}

// collectDisks 遍历物理磁盘分区并采集每个的使用情况；整体失败回退空切片，单分区失败跳过。
func (s *Service) collectDisks() []DiskVO {
	parts, err := disk.Partitions(false) // false=仅物理分区
	if err != nil {
		s.warn("采集磁盘分区失败: %v", err)
		return []DiskVO{}
	}
	out := make([]DiskVO, 0, len(parts))
	for _, p := range parts {
		usage, err := disk.Usage(p.Mountpoint)
		if err != nil || usage == nil {
			s.warn("采集磁盘使用率失败 path=%s: %v", p.Mountpoint, err)
			continue
		}
		out = append(out, DiskVO{
			Path:  usage.Path,
			Total: usage.Total,
			Free:  usage.Free,
			Used:  usage.Used,
			Usage: clampPct(usage.UsedPercent),
		})
	}
	return out
}

// countOnlineNics 统计 up 且非 loopback 的网卡数。
func (s *Service) countOnlineNics() int {
	ifaces, err := gopsnet.Interfaces()
	if err != nil {
		s.warn("采集网卡失败: %v", err)
		return 0
	}
	count := 0
	for _, ifc := range ifaces {
		up, loopback := false, false
		for _, f := range ifc.Flags {
			switch strings.ToLower(f) {
			case "up":
				up = true
			case "loopback":
				loopback = true
			}
		}
		if up && !loopback {
			count++
		}
	}
	return count
}

// fillAuthStats 填充近 7 天认证成功/失败/成功率（login_log 聚合失败回退 0，成功率回退 100）。
func (s *Service) fillAuthStats(vo *SystemMetricsVO) {
	since := time.Now().AddDate(0, 0, -authStatDays)
	success, fail, err := s.repo.CountAuthSince(since)
	if err != nil {
		s.warn("统计近7天认证失败: %v", err)
		vo.AuthSuccessRate = 100 // 无数据时展示 100%（与前端默认 100 一致）
		return
	}
	vo.AuthSuccess = success
	vo.AuthFail = fail
	total := success + fail
	if total <= 0 {
		vo.AuthSuccessRate = 100
		return
	}
	vo.AuthSuccessRate = clampPct(float64(success) / float64(total) * 100)
}

// RedisInfo 采集 Redis 接入状态。rdb 为 nil → connected=false，其余 0/空。
// 否则解析 INFO 文本取 version/uptime/used_memory_human/命中率，并用 DBSize 取 key 数。
func (s *Service) RedisInfo() *RedisInfoVO {
	vo := &RedisInfoVO{}
	if s.rdb == nil {
		return vo // 未配置 Redis：connected=false
	}
	ctx := context.Background()

	infoText, err := s.rdb.Info(ctx).Result()
	if err != nil {
		s.warn("获取Redis INFO失败: %v", err)
		return vo // 连接不可用：视为未连接
	}
	vo.Connected = true

	fields := parseRedisInfo(infoText)
	vo.Version = fields["redis_version"]
	vo.UsedMemoryHuman = fields["used_memory_human"]
	if v, err := strconv.ParseInt(fields["uptime_in_seconds"], 10, 64); err == nil {
		vo.UptimeSeconds = v
	}
	hits := parseInt64(fields["keyspace_hits"])
	misses := parseInt64(fields["keyspace_misses"])
	if total := hits + misses; total > 0 {
		vo.HitRate = clampPct(float64(hits) / float64(total) * 100)
	}

	if n, err := s.rdb.DBSize(ctx).Result(); err == nil {
		vo.KeyCount = n
	} else {
		s.warn("获取Redis DBSize失败: %v", err)
	}
	return vo
}

// Sessions 近 15 分钟、按 IP 去重的近似在线会话，按最后活跃时间倒序，最多 sessionLimit 条。
func (s *Service) Sessions() []SessionVO {
	since := time.Now().Add(-sessionWindow)
	rows, err := s.repo.RecentSessions(since, sessionLimit)
	if err != nil {
		s.warn("查询近期会话失败: %v", err)
		return []SessionVO{}
	}
	out := make([]SessionVO, 0, len(rows))
	seen := make(map[string]struct{}, len(rows)) // 兜底去重：同 IP 同时刻多行时仅取最新一条
	for i := range rows {
		ip := rows[i].IP
		if _, dup := seen[ip]; dup {
			continue
		}
		seen[ip] = struct{}{}
		out = append(out, SessionVO{
			Username:       nilIfEmpty(rows[i].Username),
			IP:             ip,
			UserAgent:      nilIfEmpty(rows[i].UserAgent),
			LastActiveTime: rows[i].CreateTime.Format(sessionTimeLayout),
		})
	}
	return out
}

// ---- 辅助 ----

// parseRedisInfo 解析 Redis INFO 文本为 key=value map（忽略以 # 开头的分节标题与空行）。
func parseRedisInfo(text string) map[string]string {
	m := make(map[string]string, 64)
	for _, line := range strings.Split(text, "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		if i := strings.IndexByte(line, ':'); i > 0 {
			m[line[:i]] = line[i+1:]
		}
	}
	return m
}

func parseInt64(s string) int64 {
	v, _ := strconv.ParseInt(strings.TrimSpace(s), 10, 64)
	return v
}

// osDisplayName 组装可读的操作系统名（如 "Windows 11 / windows" 或回退 platform）。
func osDisplayName(info *host.InfoStat) string {
	parts := make([]string, 0, 3)
	if info.Platform != "" {
		parts = append(parts, info.Platform)
	}
	if info.PlatformVersion != "" {
		parts = append(parts, info.PlatformVersion)
	}
	if len(parts) == 0 {
		return info.OS
	}
	return strings.Join(parts, " ")
}

// clampPct 将百分比浮点四舍五入并钳制到 [0,100]。
func clampPct(v float64) int {
	n := int(math.Round(v))
	if n < 0 {
		return 0
	}
	if n > 100 {
		return 100
	}
	return n
}

// ratioPct 计算 used/max 的百分比（max<=0 → 0），钳制到 [0,100]。
func ratioPct(used, max uint64) int {
	if max == 0 {
		return 0
	}
	return clampPct(float64(used) / float64(max) * 100)
}

// clampScore 健康评分四舍五入并钳制到 [0,100]。
func clampScore(v float64) int { return clampPct(v) }

// round1 保留 1 位小数。
func round1(v float64) float64 { return math.Round(v*10) / 10 }

// nilIfEmpty 空串映射为 nil（对齐前端可空字段 string | null）。
func nilIfEmpty(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

func (s *Service) warn(format string, args ...interface{}) {
	if s.logger != nil {
		s.logger.Warnf(format, args...)
	}
}
