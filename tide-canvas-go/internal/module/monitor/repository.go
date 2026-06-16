package monitor

import (
	"time"

	"gorm.io/gorm"

	"github.com/tidecanvas/tide-canvas-go/internal/model"
)

// Repository 监控数据访问（GORM）：认证统计取 login_log，在线会话取 access_log。
type Repository struct {
	db *gorm.DB
}

// NewRepository 构造。
func NewRepository(db *gorm.DB) *Repository { return &Repository{db: db} }

// authStatRow 认证成功/失败聚合行（按 status 分组计数）。
type authStatRow struct {
	Status int   `gorm:"column:status"`
	Cnt    int64 `gorm:"column:cnt"`
}

// CountAuthSince 统计 since 之后登录日志按结果(status)的分组计数（1=成功 0=失败）。
// 返回 (成功数, 失败数, error)。
func (r *Repository) CountAuthSince(since time.Time) (success int64, fail int64, err error) {
	var rows []authStatRow
	err = r.db.Model(&model.LoginLog{}).
		Select("status, COUNT(*) AS cnt").
		Where("create_time >= ?", since).
		Group("status").
		Scan(&rows).Error
	if err != nil {
		return 0, 0, err
	}
	for _, row := range rows {
		if row.Status == 1 {
			success += row.Cnt
		} else {
			fail += row.Cnt
		}
	}
	return success, fail, nil
}

// sessionRow 在线会话近似行（每 IP 取最近一条访问）。
type sessionRow struct {
	Username   string    `gorm:"column:username"`
	IP         string    `gorm:"column:ip"`
	UserAgent  string    `gorm:"column:user_agent"`
	CreateTime time.Time `gorm:"column:create_time"`
}

// RecentSessions 近 since 之后、按 IP 去重的近似在线会话（每 IP 取其最近一条访问记录），
// 按最后活跃时间倒序，最多 limit 条。
//
// JWT 无状态、无服务端会话表，故用 access_log 近似：以 IP 为会话标识，取每 IP 的 MAX(create_time)
// 那一行（username/user_agent 取该最新行的值）。空 IP 行跳过。
func (r *Repository) RecentSessions(since time.Time, limit int) ([]sessionRow, error) {
	// 子查询：每个非空 IP 的最近访问时间。
	latest := r.db.Model(&model.AccessLog{}).
		Select("ip, MAX(create_time) AS last_time").
		Where("create_time >= ? AND ip <> ''", since).
		Group("ip")

	var rows []sessionRow
	// 关联回明细取该最近时刻的 username/user_agent；按活跃时间倒序限量。
	err := r.db.Table("access_log AS a").
		Select("a.username AS username, a.ip AS ip, a.user_agent AS user_agent, a.create_time AS create_time").
		Joins("JOIN (?) AS t ON t.ip = a.ip AND t.last_time = a.create_time", latest).
		Order("a.create_time DESC").
		Limit(limit).
		Scan(&rows).Error
	if err != nil {
		return nil, err
	}
	return rows, nil
}
