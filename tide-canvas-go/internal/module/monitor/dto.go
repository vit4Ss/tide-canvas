// Package monitor 系统监控模块：服务器运行指标 / Redis 接入状态 / 近期在线会话，
// 供后台「监控总览」页（前端 adminApi.monitor）使用，统一挂载于 /api/admin/monitor/*。
//
// Java→Go 迁移补缺：旧后端用 Spring Boot Actuator + JVM 指标，本实现用 gopsutil 采集主机指标，
// JVM 堆字段以 Go runtime.MemStats 近似填充（见 service.go 说明）。全部接口 JWTAuth + AdminOnly +
// RequiresPermission("monitor:view")。
//
// 各 VO 字段名 / 类型一一对应前端 types/monitor.ts（SystemMetricsVO / RedisInfoVO / SessionVO / DiskVO）。
package monitor

// DiskVO 单个磁盘分区使用情况（对齐 types/monitor.ts DiskVO）。字节为单位。
type DiskVO struct {
	Path  string `json:"path"`  // 挂载点 / 盘符（如 / 或 C:\）
	Total uint64 `json:"total"` // 总容量(字节)
	Free  uint64 `json:"free"`  // 可用(字节)
	Used  uint64 `json:"used"`  // 已用(字节)
	Usage int    `json:"usage"` // 使用率百分比(0-100，四舍五入)
}

// SystemMetricsVO 系统运行指标（对齐 types/monitor.ts SystemMetricsVO）。
type SystemMetricsVO struct {
	CPUUsage        int      `json:"cpuUsage"`        // CPU 使用率(%)
	CPUCores        int      `json:"cpuCores"`        // 逻辑核数
	LoadAverage     float64  `json:"loadAverage"`     // 1 分钟负载(Windows 取不到→0)
	MemUsed         uint64   `json:"memUsed"`         // 已用内存(字节)
	MemTotal        uint64   `json:"memTotal"`        // 总内存(字节)
	MemUsage        int      `json:"memUsage"`        // 内存使用率(%)
	JvmHeapUsed     uint64   `json:"jvmHeapUsed"`     // Go 无 JVM：用 runtime HeapAlloc 近似
	JvmHeapMax      uint64   `json:"jvmHeapMax"`      // 用 runtime HeapSys 近似
	JvmHeapUsage    int      `json:"jvmHeapUsage"`    // 堆使用率(%)
	Pid             int      `json:"pid"`             // 进程 PID
	OsName          string   `json:"osName"`          // 操作系统名
	OsArch          string   `json:"osArch"`          // 架构(amd64/arm64...)
	UptimeMs        int64    `json:"uptimeMs"`        // 进程启动至今(毫秒)
	OnlineNics      int      `json:"onlineNics"`      // 在线网卡数(up 且非 loopback)
	HealthScore     int      `json:"healthScore"`     // 综合健康评分(0-100)
	Disks           []DiskVO `json:"disks"`           // 各磁盘分区(永不为 null)
	AuthSuccess     int64    `json:"authSuccess"`     // 近7天认证成功数(login_log status=1)
	AuthFail        int64    `json:"authFail"`        // 近7天认证失败数(login_log status=0)
	AuthSuccessRate int      `json:"authSuccessRate"` // 认证成功率(%)
}

// RedisInfoVO Redis 接入状态（对齐 types/monitor.ts RedisInfoVO）。未配置 Redis → connected=false，其余 0/空。
type RedisInfoVO struct {
	Connected       bool   `json:"connected"`       // 是否已连接
	KeyCount        int64  `json:"keyCount"`        // 当前库 key 数(DBSize)
	HitRate         int    `json:"hitRate"`         // 命中率(%)：hits/(hits+misses)
	Version         string `json:"version"`         // redis_version
	UptimeSeconds   int64  `json:"uptimeSeconds"`   // uptime_in_seconds
	UsedMemoryHuman string `json:"usedMemoryHuman"` // used_memory_human
}

// SessionVO 近期在线会话（对齐 types/monitor.ts SessionVO）。JWT 无状态，用 access_log 近 15 分钟去重近似。
//
// 注意：lastActiveTime 为 "yyyy-MM-dd HH:mm:ss" 字符串（前端 toMs 用 s.replace(" ","T") 解析），
// 不可用 time.Time 默认 RFC3339 序列化。username / userAgent 为可空（前端类型 string | null）。
type SessionVO struct {
	Username       *string `json:"username"`       // 用户名(匿名→null)
	IP             string  `json:"ip"`             // 客户端 IP
	UserAgent      *string `json:"userAgent"`      // UA(缺失→null)
	LastActiveTime string  `json:"lastActiveTime"` // 最后活跃时间 "2006-01-02 15:04:05"
}
