package log

import (
	"time"

	"gorm.io/gorm"

	"github.com/tidecanvas/tide-canvas-go/internal/model"
)

// Repository 日志数据访问（GORM）。日志表无逻辑删除，按 create_time 倒序分页。
type Repository struct {
	db *gorm.DB
}

// NewRepository 构造。
func NewRepository(db *gorm.DB) *Repository { return &Repository{db: db} }

// =====================================================================
// 操作日志 sys_log
// =====================================================================

// InsertSysLog 写入一条操作日志（供 RecordOperation 调用）。
func (r *Repository) InsertSysLog(entry *model.SysLog) error {
	return r.db.Create(entry).Error
}

// PageSysLogs 操作日志分页（对齐 AdminLogController.list）：
// userId 精确、action 精确、detail 模糊；按 create_time 倒序。
func (r *Repository) PageSysLogs(q *SysLogQuery) ([]model.SysLog, int64, error) {
	tx := r.db.Model(&model.SysLog{})
	if q.UserID != nil {
		tx = tx.Where("user_id = ?", *q.UserID)
	}
	if q.Action != "" {
		tx = tx.Where("action = ?", q.Action)
	}
	if q.Keyword != "" {
		tx = tx.Where("detail LIKE ?", "%"+q.Keyword+"%")
	}
	tx = applyTimeRange(tx, q.StartTime, q.EndTime)

	var total int64
	if err := tx.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	var records []model.SysLog
	if err := tx.Order("create_time DESC").
		Offset(q.Offset()).Limit(q.PageSize).
		Find(&records).Error; err != nil {
		return nil, 0, err
	}
	return records, total, nil
}

// DeleteSysLog 按主键删除一条操作日志（物理删除，对齐 deleteById）。
func (r *Repository) DeleteSysLog(id int64) error {
	return r.db.Delete(&model.SysLog{}, id).Error
}

// =====================================================================
// 访问日志 access_log
// =====================================================================

// PageAccessLogs 访问日志分页（对齐 AdminAccessLogController.list）：
// userId 精确、path 模糊、keyword 模糊匹配 username/ip、时间区间；按 create_time 倒序。
func (r *Repository) PageAccessLogs(q *AccessLogQuery) ([]model.AccessLog, int64, error) {
	tx := r.db.Model(&model.AccessLog{})
	if q.UserID != nil {
		tx = tx.Where("user_id = ?", *q.UserID)
	}
	if q.Path != "" {
		tx = tx.Where("path LIKE ?", "%"+q.Path+"%")
	}
	if q.Keyword != "" {
		kw := "%" + q.Keyword + "%"
		// and 包裹 or，避免与其它条件串联（对齐旧 .and(w -> w.like(username).or().like(ip))）
		tx = tx.Where(r.db.Where("username LIKE ?", kw).Or("ip LIKE ?", kw))
	}
	tx = applyTimeRange(tx, q.StartTime, q.EndTime)

	var total int64
	if err := tx.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	var records []model.AccessLog
	if err := tx.Order("create_time DESC").
		Offset(q.Offset()).Limit(q.PageSize).
		Find(&records).Error; err != nil {
		return nil, 0, err
	}
	return records, total, nil
}

// DeleteAccessLog 按主键删除一条访问日志（物理删除）。
func (r *Repository) DeleteAccessLog(id int64) error {
	return r.db.Delete(&model.AccessLog{}, id).Error
}

// =====================================================================
// 登录日志 login_log
// =====================================================================

// PageLoginLogs 登录日志分页（对齐 AdminLoginLogController.list）：
// status 精确、keyword 模糊匹配 username/ip、时间区间；按 create_time 倒序。
func (r *Repository) PageLoginLogs(q *LoginLogQuery) ([]model.LoginLog, int64, error) {
	tx := r.db.Model(&model.LoginLog{})
	if q.Status != nil {
		tx = tx.Where("status = ?", *q.Status)
	}
	if q.Keyword != "" {
		kw := "%" + q.Keyword + "%"
		tx = tx.Where(r.db.Where("username LIKE ?", kw).Or("ip LIKE ?", kw))
	}
	tx = applyTimeRange(tx, q.StartTime, q.EndTime)

	var total int64
	if err := tx.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	var records []model.LoginLog
	if err := tx.Order("create_time DESC").
		Offset(q.Offset()).Limit(q.PageSize).
		Find(&records).Error; err != nil {
		return nil, 0, err
	}
	return records, total, nil
}

// DeleteLoginLog 按主键删除一条登录日志（物理删除）。
func (r *Repository) DeleteLoginLog(id int64) error {
	return r.db.Delete(&model.LoginLog{}, id).Error
}

// =====================================================================
// 统计（PV / UV / 登录），对齐 AccessLogMapper / LoginLogMapper 的聚合
// =====================================================================

// CountTodayPv 今日访问量 PV：按 IP+半小时会话去重（对齐 countTodayPv）。
func (r *Repository) CountTodayPv() (int64, error) {
	var n int64
	err := r.db.Model(&model.AccessLog{}).
		Select("COUNT(DISTINCT CONCAT(ip, '-', FLOOR(UNIX_TIMESTAMP(create_time) / 1800)))").
		Where("DATE(create_time) = CURDATE()").Scan(&n).Error
	return n, err
}

// CountTodayUv 今日独立访客 UV（按 IP 去重，对齐 countTodayUv）。
func (r *Repository) CountTodayUv() (int64, error) {
	var n int64
	err := r.db.Model(&model.AccessLog{}).
		Select("COUNT(DISTINCT ip)").
		Where("DATE(create_time) = CURDATE()").Scan(&n).Error
	return n, err
}

// CountTodayLogins 今日成功登录次数（status=1，对齐 countTodayLogins）。
func (r *Repository) CountTodayLogins() (int64, error) {
	var n int64
	err := r.db.Model(&model.LoginLog{}).
		Where("status = 1 AND DATE(create_time) = CURDATE()").Count(&n).Error
	return n, err
}

// PvByDateRange 逐日 PV（IP+半小时会话去重，对齐 pvByDateRange）。
func (r *Repository) PvByDateRange(start, end time.Time) ([]dateCountRow, error) {
	var rows []dateCountRow
	err := r.db.Model(&model.AccessLog{}).
		Select("DATE(create_time) AS date, COUNT(DISTINCT CONCAT(ip, '-', FLOOR(UNIX_TIMESTAMP(create_time) / 1800))) AS count").
		Where("create_time BETWEEN ? AND ?", start, end).
		Group("DATE(create_time)").Order("date").Scan(&rows).Error
	return rows, err
}

// UvByDateRange 逐日 UV（IP 去重，对齐 uvByDateRange）。
func (r *Repository) UvByDateRange(start, end time.Time) ([]dateCountRow, error) {
	var rows []dateCountRow
	err := r.db.Model(&model.AccessLog{}).
		Select("DATE(create_time) AS date, COUNT(DISTINCT ip) AS count").
		Where("create_time BETWEEN ? AND ?", start, end).
		Group("DATE(create_time)").Order("date").Scan(&rows).Error
	return rows, err
}

// applyTimeRange 追加 create_time 区间过滤（与旧 .ge(startTime).le(endTime) 等价，空值跳过）。
func applyTimeRange(tx *gorm.DB, startTime, endTime string) *gorm.DB {
	if startTime != "" {
		tx = tx.Where("create_time >= ?", startTime)
	}
	if endTime != "" {
		tx = tx.Where("create_time <= ?", endTime)
	}
	return tx
}
