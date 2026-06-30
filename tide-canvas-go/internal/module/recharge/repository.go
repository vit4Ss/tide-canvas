package recharge

import (
	"errors"
	"strings"
	"time"

	"gorm.io/gorm"

	"github.com/tidecanvas/tide-canvas-go/internal/model"
)

// Repository 充值订单 / 系统配置数据访问（GORM）。逻辑删除由模型 deleted 字段自动过滤。
type Repository struct {
	db *gorm.DB
}

// NewRepository 构造。
func NewRepository(db *gorm.DB) *Repository { return &Repository{db: db} }

// DB 暴露底层连接（供上层做事务）。
func (r *Repository) DB() *gorm.DB { return r.db }

// ---- recharge_order ----

// Create 新增订单（主键/public_id 由模型 BeforeCreate 注入）。
func (r *Repository) Create(o *model.RechargeOrder) error {
	return r.db.Create(o).Error
}

// FindByID 按主键查询，未找到返回 (nil, nil)（对齐 selectById）。
func (r *Repository) FindByID(id int64) (*model.RechargeOrder, error) {
	var o model.RechargeOrder
	err := r.db.First(&o, id).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &o, nil
}

// FindByPublicID 按对外ID查询，未找到返回 (nil, nil)。
func (r *Repository) FindByPublicID(publicID string) (*model.RechargeOrder, error) {
	var o model.RechargeOrder
	err := r.db.Where("public_id = ?", publicID).First(&o).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &o, nil
}

// FindByOrderNo 按业务单号查询，未找到返回 (nil, nil)（对齐回调中按 order_no 查单）。
func (r *Repository) FindByOrderNo(orderNo string) (*model.RechargeOrder, error) {
	var o model.RechargeOrder
	err := r.db.Where("order_no = ?", orderNo).First(&o).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &o, nil
}

// UpdatePaymentMethod 仅更新支付方式（对齐 initiatePay 中按 id 局部更新 paymentMethod）。
func (r *Repository) UpdatePaymentMethod(id int64, paymentMethod string) error {
	return r.db.Model(&model.RechargeOrder{}).
		Where("id = ?", id).
		Update("payment_method", paymentMethod).Error
}

// MarkPaidIfPayable 条件入账：待支付或已超时的订单都可被确认为已支付（对齐 markPaidIfPayable）。
// 须在事务中调用（tx）。paymentNo/paymentMethod 为空时保留原值（COALESCE）。返回受影响行数。
func (r *Repository) MarkPaidIfPayable(tx *gorm.DB, id int64, pendingStatus, timeoutStatus, paidStatus int, paymentNo, paymentMethod *string) (int64, error) {
	res := tx.Model(&model.RechargeOrder{}).
		Where("id = ? AND status IN (?, ?)", id, pendingStatus, timeoutStatus).
		Updates(map[string]interface{}{
			"status":         paidStatus,
			"paid_time":      gorm.Expr("NOW()"),
			"update_time":    gorm.Expr("NOW()"),
			"payment_no":     gorm.Expr("COALESCE(?, payment_no)", paymentNo),
			"payment_method": gorm.Expr("COALESCE(?, payment_method)", paymentMethod),
		})
	if res.Error != nil {
		return 0, res.Error
	}
	return res.RowsAffected, nil
}

// MarkCancelledIfPending 条件取消：仅待支付订单可取消（对齐 markCancelledIfPending）。返回受影响行数。
func (r *Repository) MarkCancelledIfPending(id int64, pendingStatus, cancelledStatus int) (int64, error) {
	res := r.db.Model(&model.RechargeOrder{}).
		Where("id = ? AND status = ?", id, pendingStatus).
		Updates(map[string]interface{}{
			"status":      cancelledStatus,
			"update_time": gorm.Expr("NOW()"),
		})
	if res.Error != nil {
		return 0, res.Error
	}
	return res.RowsAffected, nil
}

// MarkTimeoutBeforeCutoff 把创建早于 cutoff 仍待支付的订单批量标记为已超时，返回关闭笔数
// （对齐 markTimeoutBeforeCutoff / OrderTimeoutTask）。
func (r *Repository) MarkTimeoutBeforeCutoff(pendingStatus, timeoutStatus int, cutoff time.Time) (int64, error) {
	res := r.db.Model(&model.RechargeOrder{}).
		Where("status = ? AND create_time < ?", pendingStatus, cutoff).
		Updates(map[string]interface{}{
			"status":      timeoutStatus,
			"update_time": gorm.Expr("NOW()"),
		})
	if res.Error != nil {
		return 0, res.Error
	}
	return res.RowsAffected, nil
}

// PageUserOrders 分页查询某用户订单：按条件过滤并按 create_time 倒序（对齐 listOrders）。
func (r *Repository) PageUserOrders(userID int64, q *OrderQuery) ([]model.RechargeOrder, int64, error) {
	tx := r.db.Model(&model.RechargeOrder{}).Where("user_id = ?", userID)
	if q.Status != nil {
		tx = tx.Where("status = ?", *q.Status)
	}
	if start, ok := parseDateTime(q.StartTime); ok {
		tx = tx.Where("create_time >= ?", start)
	}
	if end, ok := parseDateTime(q.EndTime); ok {
		tx = tx.Where("create_time <= ?", end)
	}
	return pageOrders(tx, q.PageNum, q.PageSize)
}

// PageAllOrders 管理端分页查询全部订单（对齐 listAllOrders）。
func (r *Repository) PageAllOrders(q *AdminOrderQuery) ([]model.RechargeOrder, int64, error) {
	tx := r.db.Model(&model.RechargeOrder{})
	if q.UserID != nil {
		tx = tx.Where("user_id = ?", *q.UserID)
	}
	keyword := strings.TrimSpace(q.Keyword)
	userKeyword := strings.TrimSpace(q.UserKeyword)
	if keyword != "" {
		kw := "%" + keyword + "%"
		tx = tx.Joins("JOIN sys_user u ON u.id = recharge_order.user_id").
			Where("(recharge_order.order_no LIKE ? OR u.nickname LIKE ? OR u.username LIKE ? OR u.email LIKE ?)", kw, kw, kw, kw)
	} else if userKeyword != "" {
		kw := "%" + userKeyword + "%"
		tx = tx.Joins("JOIN sys_user u ON u.id = recharge_order.user_id").
			Where("(u.nickname LIKE ? OR u.username LIKE ? OR u.email LIKE ?)", kw, kw, kw)
	}
	if q.Status != nil {
		tx = tx.Where("recharge_order.status = ?", *q.Status)
	}
	if q.OrderNo != "" {
		tx = tx.Where("recharge_order.order_no LIKE ?", "%"+q.OrderNo+"%")
	}
	if start, ok := parseDateTime(q.StartTime); ok {
		tx = tx.Where("recharge_order.create_time >= ?", start)
	}
	if end, ok := parseDateTime(q.EndTime); ok {
		tx = tx.Where("recharge_order.create_time <= ?", end)
	}
	return pageOrders(tx, q.PageNum, q.PageSize)
}

// pageOrders 统一分页执行：先 Count 再按 create_time 倒序取当页。
func pageOrders(tx *gorm.DB, pageNum, pageSize int) ([]model.RechargeOrder, int64, error) {
	var total int64
	if err := tx.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	var records []model.RechargeOrder
	if err := tx.Order("recharge_order.create_time DESC").
		Offset((pageNum - 1) * pageSize).
		Limit(pageSize).
		Find(&records).Error; err != nil {
		return nil, 0, err
	}
	return records, total, nil
}

func (r *Repository) UserDisplayNames(ids []int64) (map[int64]string, error) {
	out := make(map[int64]string, len(ids))
	if len(ids) == 0 {
		return out, nil
	}
	type row struct {
		ID       int64
		Username string
		Nickname string
	}
	var rows []row
	if err := r.db.Model(&model.SysUser{}).
		Select("id", "username", "nickname").
		Where("id IN ?", ids).
		Find(&rows).Error; err != nil {
		return nil, err
	}
	for _, r := range rows {
		name := strings.TrimSpace(r.Nickname)
		if name == "" {
			name = strings.TrimSpace(r.Username)
		}
		out[r.ID] = name
	}
	return out, nil
}

// ---- sys_config ----

// FindConfigValues 批量读取配置项的值（仅返回有值的项），对齐 PaymentServiceImpl.loadConfigMap。
func (r *Repository) FindConfigValues(keys []string) (map[string]string, error) {
	var configs []model.SysConfig
	if err := r.db.Where("config_key IN ?", keys).Find(&configs).Error; err != nil {
		return nil, err
	}
	out := make(map[string]string, len(configs))
	for i := range configs {
		out[configs[i].ConfigKey] = configs[i].ConfigValue
	}
	return out, nil
}
