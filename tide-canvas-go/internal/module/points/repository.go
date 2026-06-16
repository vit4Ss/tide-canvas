package points

import (
	"errors"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"github.com/tidecanvas/tide-canvas-go/internal/model"
)

// Repository 积分 / 签到数据访问（GORM）。逻辑删除由模型 deleted 字段自动过滤。
type Repository struct {
	db *gorm.DB
}

// NewRepository 构造。
func NewRepository(db *gorm.DB) *Repository { return &Repository{db: db} }

// DB 暴露底层连接（供上层做事务）。
func (r *Repository) DB() *gorm.DB { return r.db }

// ---- sys_user 积分（事务内使用，须传入 tx） ----

// LockUserForUpdate 行锁读取用户（SELECT ... FOR UPDATE，对齐旧 selectForUpdate）。
// 未找到返回 (nil, nil)。须在事务中调用。
func (r *Repository) LockUserForUpdate(tx *gorm.DB, userID int64) (*model.SysUser, error) {
	var u model.SysUser
	err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&u, userID).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &u, nil
}

// AddUserPoints 原子增加用户积分：points = points + amount（事务内，对齐 setSql）。
func (r *Repository) AddUserPoints(tx *gorm.DB, userID int64, amount int) error {
	return tx.Model(&model.SysUser{}).
		Where("id = ?", userID).
		UpdateColumn("points", gorm.Expr("points + ?", amount)).Error
}

// DeductUserPoints 原子扣减用户积分：points = points - amount，且 WHERE points >= amount
// 校验影响行数兜底防并发超扣（行锁 + 条件双保险）。扣减成功返回 true。
func (r *Repository) DeductUserPoints(tx *gorm.DB, userID int64, amount int) (bool, error) {
	res := tx.Model(&model.SysUser{}).
		Where("id = ? AND points >= ?", userID, amount).
		UpdateColumn("points", gorm.Expr("points - ?", amount))
	if res.Error != nil {
		return false, res.Error
	}
	return res.RowsAffected > 0, nil
}

// CreateTransaction 写入一条积分流水（事务内）。
func (r *Repository) CreateTransaction(tx *gorm.DB, t *model.PointsTransaction) error {
	return tx.Create(t).Error
}

// ---- sys_user 余额（只读） ----

// FindUser 按主键查询用户，未找到返回 (nil, nil)。
func (r *Repository) FindUser(userID int64) (*model.SysUser, error) {
	var u model.SysUser
	err := r.db.First(&u, userID).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &u, nil
}

// ---- points_transaction（分页查询） ----

// PageTransactions 分页查询积分流水：按条件过滤并按 create_time 倒序，返回当页记录与总数。
// userID 非 nil 时按用户过滤（对齐 listTransactions / listAllTransactions 的 baseQuery）。
func (r *Repository) PageTransactions(q *TransactionQuery, userID *int64) ([]model.PointsTransaction, int64, error) {
	tx := r.db.Model(&model.PointsTransaction{})
	if userID != nil {
		tx = tx.Where("user_id = ?", *userID)
	}
	if q.Type != nil {
		tx = tx.Where("type = ?", *q.Type)
	}
	if start, ok := parseDateTime(q.StartTime); ok {
		tx = tx.Where("create_time >= ?", start)
	}
	if end, ok := parseDateTime(q.EndTime); ok {
		tx = tx.Where("create_time <= ?", end)
	}

	var total int64
	if err := tx.Count(&total).Error; err != nil {
		return nil, 0, err
	}

	var records []model.PointsTransaction
	if err := tx.Order("create_time DESC").
		Offset((q.PageNum - 1) * q.PageSize).
		Limit(q.PageSize).
		Find(&records).Error; err != nil {
		return nil, 0, err
	}
	return records, total, nil
}

// ---- checkin_record ----

// FindCheckinByDate 查询用户某日签到记录，未找到返回 (nil, nil)。
func (r *Repository) FindCheckinByDate(userID int64, date time.Time) (*model.CheckinRecord, error) {
	var rec model.CheckinRecord
	err := r.db.Where("user_id = ? AND checkin_date = ?", userID, date).First(&rec).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &rec, nil
}

// CountCheckinByDate 统计用户某日签到次数（对齐 getBalance 中的 selectCount）。
func (r *Repository) CountCheckinByDate(userID int64, date time.Time) (int64, error) {
	var n int64
	err := r.db.Model(&model.CheckinRecord{}).
		Where("user_id = ? AND checkin_date = ?", userID, date).
		Count(&n).Error
	return n, err
}

// CreateCheckin 写入签到记录（事务内）。
func (r *Repository) CreateCheckin(tx *gorm.DB, rec *model.CheckinRecord) error {
	return tx.Create(rec).Error
}

// ListCheckinBetween 查询用户某时间段内的签到记录，按 checkin_date 升序（对齐 getCalendar）。
func (r *Repository) ListCheckinBetween(userID int64, start, end time.Time) ([]model.CheckinRecord, error) {
	var records []model.CheckinRecord
	err := r.db.Where("user_id = ? AND checkin_date >= ? AND checkin_date <= ?", userID, start, end).
		Order("checkin_date ASC").
		Find(&records).Error
	return records, err
}

// ---- sys_config ----

// FindConfigValue 读取配置项的值，未配置返回 (nil, nil)（对齐 CheckinServiceImpl.getConfigInt）。
func (r *Repository) FindConfigValue(key string) (*string, error) {
	var cfg model.SysConfig
	err := r.db.Where("config_key = ?", key).First(&cfg).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &cfg.ConfigValue, nil
}
