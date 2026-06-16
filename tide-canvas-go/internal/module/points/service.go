package points

import (
	"strconv"
	"strings"
	"time"

	"github.com/sirupsen/logrus"
	"gorm.io/gorm"

	"github.com/tidecanvas/tide-canvas-go/internal/model"
	"github.com/tidecanvas/tide-canvas-go/pkg/ecode"
)

// 时间格式（对齐旧 yyyy-MM-dd HH:mm:ss / yyyy-MM-dd）。
const (
	dateTimeLayout = "2006-01-02 15:04:05"
	dateLayout     = "2006-01-02"
)

// 签到积分配置项 key（对齐 CheckinServiceImpl）。
const (
	configCheckinBase        = "points.checkin.base"
	configCheckinStreakBonus = "points.checkin.streak.bonus"
	configCheckinStreakCap   = "points.checkin.streak.cap"
)

// 签到积分默认值（对齐 CheckinServiceImpl）。
const (
	defaultCheckinBase = 10
	defaultStreakBonus = 2
	defaultStreakCap   = 20
)

// Service 积分与签到服务接口。
//
// 【对外提供给其他模块（兑换码/博客/AI/充值/管理端）注入复用的能力】：AddPoints / DeductPoints。
// 其余方法服务本模块 handler（余额、流水分页、签到）。
type Service interface {
	// AddPoints 加积分并写流水（事务：行锁读用户 → 更新 sys_user.points → 写 balance_after）。
	// amount 必须 > 0。bizID 可空。txType 取本包 Tx* 常量。
	AddPoints(userID int64, amount, txType int, bizID *int64, remark string) error
	// DeductPoints 扣积分并写流水（事务）。余额不足返回 ecode.PointsInsufficient。
	DeductPoints(userID int64, amount, txType int, bizID *int64, remark string) error

	// AddPointsTx / DeductPointsTx 在调用方已开启的事务 tx 内加 / 扣积分（同一物理事务，
	// 保证积分变动与调用方业务写入原子）。供 redeem/blog/recharge/admin 在自己的
	// db.Transaction(func(tx){...}) 内复用，彻底解决跨模块事务一致性。
	AddPointsTx(tx *gorm.DB, userID int64, amount, txType int, bizID *int64, remark string) error
	DeductPointsTx(tx *gorm.DB, userID int64, amount, txType int, bizID *int64, remark string) error

	// GetBalance 查询积分余额及今日是否已签到。
	GetBalance(userID int64) (*PointsBalanceVO, error)
	// ListTransactions 分页查询某用户的积分流水。
	ListTransactions(userID int64, q *TransactionQuery) ([]PointsTransactionVO, int64, error)
	// ListAllTransactions 管理端分页查询全部积分流水（q.UserID 非空则按用户过滤）。
	ListAllTransactions(q *TransactionQuery) ([]PointsTransactionVO, int64, error)

	// Checkin 每日签到（事务）。今日已签到返回 ecode.AlreadyCheckedIn。
	Checkin(userID int64) (*CheckinStatusVO, error)
	// CheckinStatus 获取今日签到状态。
	CheckinStatus(userID int64) (*CheckinStatusVO, error)
	// CheckinCalendar 获取某年某月的签到日历。
	CheckinCalendar(userID int64, year, month int) (*CheckinCalendarVO, error)
}

// service 是 Service 的默认实现，聚合 PointsServiceImpl + CheckinServiceImpl 两段旧逻辑。
type service struct {
	repo   *Repository
	db     *gorm.DB
	logger *logrus.Logger
}

// 编译期断言：service 实现 Service。
var _ Service = (*service)(nil)

// NewService 构造积分服务。logger 可为 nil。
func NewService(repo *Repository, logger *logrus.Logger) Service {
	return &service{repo: repo, db: repo.DB(), logger: logger}
}

// AddPoints 加积分 + 写流水（自开事务）。对齐 PointsServiceImpl.addPoints。
func (s *service) AddPoints(userID int64, amount, txType int, bizID *int64, remark string) error {
	return s.db.Transaction(func(tx *gorm.DB) error {
		return s.AddPointsTx(tx, userID, amount, txType, bizID, remark)
	})
}

// AddPointsTx 在调用方事务 tx 内加积分 + 写流水（同一事务）。
func (s *service) AddPointsTx(tx *gorm.DB, userID int64, amount, txType int, bizID *int64, remark string) error {
	if err := assertPositiveAmount(amount); err != nil {
		return err
	}
	user, err := s.repo.LockUserForUpdate(tx, userID)
	if err != nil {
		return err
	}
	if user == nil {
		return ecode.AccountNotFound
	}
	if err := s.repo.AddUserPoints(tx, userID, amount); err != nil {
		return err
	}
	balanceAfter := user.Points + amount
	if err := s.repo.CreateTransaction(tx, newTransaction(userID, amount, balanceAfter, txType, bizID, remark)); err != nil {
		return err
	}
	s.logf("Points added: userId=%d, amount=%d, type=%s, balanceAfter=%d", userID, amount, TxTypeName(txType), balanceAfter)
	return nil
}

// DeductPoints 扣积分 + 写流水（自开事务）。对齐 PointsServiceImpl.deductPoints。
func (s *service) DeductPoints(userID int64, amount, txType int, bizID *int64, remark string) error {
	return s.db.Transaction(func(tx *gorm.DB) error {
		return s.DeductPointsTx(tx, userID, amount, txType, bizID, remark)
	})
}

// DeductPointsTx 在调用方事务 tx 内扣积分 + 写流水（同一事务）。余额不足返回 ecode.PointsInsufficient。
func (s *service) DeductPointsTx(tx *gorm.DB, userID int64, amount, txType int, bizID *int64, remark string) error {
	if err := assertPositiveAmount(amount); err != nil {
		return err
	}
	user, err := s.repo.LockUserForUpdate(tx, userID)
	if err != nil {
		return err
	}
	if user == nil {
		return ecode.AccountNotFound
	}
	if user.Points < amount {
		return ecode.PointsInsufficient
	}
	// 行锁已持有；条件更新 WHERE points>=amount 作为兜底，影响行数为 0 视为余额不足。
	ok, err := s.repo.DeductUserPoints(tx, userID, amount)
	if err != nil {
		return err
	}
	if !ok {
		return ecode.PointsInsufficient
	}
	balanceAfter := user.Points - amount
	if err := s.repo.CreateTransaction(tx, newTransaction(userID, -amount, balanceAfter, txType, bizID, remark)); err != nil {
		return err
	}
	s.logf("Points deducted: userId=%d, amount=%d, type=%s, balanceAfter=%d", userID, amount, TxTypeName(txType), balanceAfter)
	return nil
}

// GetBalance 查询积分余额。对齐 PointsServiceImpl.getBalance。
func (s *service) GetBalance(userID int64) (*PointsBalanceVO, error) {
	user, err := s.requireUser(userID)
	if err != nil {
		return nil, err
	}
	count, err := s.repo.CountCheckinByDate(userID, today())
	if err != nil {
		return nil, err
	}
	return &PointsBalanceVO{
		Points:         user.Points,
		TodayCheckedIn: count > 0,
	}, nil
}

// ListTransactions 分页查询某用户积分流水。对齐 PointsServiceImpl.listTransactions。
func (s *service) ListTransactions(userID int64, q *TransactionQuery) ([]PointsTransactionVO, int64, error) {
	q.normalize()
	records, total, err := s.repo.PageTransactions(q, &userID)
	if err != nil {
		return nil, 0, err
	}
	return toTransactionVOList(records), total, nil
}

// ListAllTransactions 管理端分页查询全部积分流水。对齐 PointsServiceImpl.listAllTransactions。
func (s *service) ListAllTransactions(q *TransactionQuery) ([]PointsTransactionVO, int64, error) {
	q.normalize()
	records, total, err := s.repo.PageTransactions(q, q.UserID)
	if err != nil {
		return nil, 0, err
	}
	return toTransactionVOList(records), total, nil
}

// Checkin 每日签到。对齐 CheckinServiceImpl.checkin。
func (s *service) Checkin(userID int64) (*CheckinStatusVO, error) {
	day := today()

	// 检查今日是否已签到
	todayRecord, err := s.repo.FindCheckinByDate(userID, day)
	if err != nil {
		return nil, err
	}
	if todayRecord != nil {
		return nil, ecode.AlreadyCheckedIn
	}

	// 计算连续签到天数
	yesterday := day.AddDate(0, 0, -1)
	yesterdayRecord, err := s.repo.FindCheckinByDate(userID, yesterday)
	if err != nil {
		return nil, err
	}
	streakDays := 1
	if yesterdayRecord != nil {
		streakDays = yesterdayRecord.StreakDays + 1
	}

	// 从配置中读取积分参数
	basePoints := s.configInt(configCheckinBase, defaultCheckinBase)
	streakBonus := s.configInt(configCheckinStreakBonus, defaultStreakBonus)
	streakCap := s.configInt(configCheckinStreakCap, defaultStreakCap)

	// 签到奖励积分: base + min(streakBonus * (streak - 1), cap)
	bonusPoints := streakBonus * (streakDays - 1)
	if bonusPoints > streakCap {
		bonusPoints = streakCap
	}
	totalPoints := basePoints + bonusPoints

	var vo *CheckinStatusVO
	err = s.db.Transaction(func(tx *gorm.DB) error {
		// 插入签到记录
		record := &model.CheckinRecord{
			UserID:        userID,
			CheckinDate:   day,
			StreakDays:    streakDays,
			PointsAwarded: totalPoints,
		}
		if err := s.repo.CreateCheckin(tx, record); err != nil {
			return err
		}
		// 增加积分（同一事务内，行锁 + 写流水）
		if err := s.AddPointsTx(tx, userID, totalPoints, TxCheckin, &record.ID, "每日签到"); err != nil {
			return err
		}
		s.logf("用户签到成功: userId=%d, streakDays=%d, pointsAwarded=%d", userID, streakDays, totalPoints)
		vo = &CheckinStatusVO{CheckedInToday: true, StreakDays: streakDays, PointsAwarded: totalPoints}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return vo, nil
}

// CheckinStatus 今日签到状态。对齐 CheckinServiceImpl.getStatus。
func (s *service) CheckinStatus(userID int64) (*CheckinStatusVO, error) {
	day := today()
	todayRecord, err := s.repo.FindCheckinByDate(userID, day)
	if err != nil {
		return nil, err
	}
	if todayRecord != nil {
		return &CheckinStatusVO{
			CheckedInToday: true,
			StreakDays:     todayRecord.StreakDays,
			PointsAwarded:  todayRecord.PointsAwarded,
		}, nil
	}
	// 未签到：查昨日记录以展示当前连续天数
	yesterday := day.AddDate(0, 0, -1)
	yesterdayRecord, err := s.repo.FindCheckinByDate(userID, yesterday)
	if err != nil {
		return nil, err
	}
	streakDays := 0
	if yesterdayRecord != nil {
		streakDays = yesterdayRecord.StreakDays
	}
	return &CheckinStatusVO{CheckedInToday: false, StreakDays: streakDays, PointsAwarded: 0}, nil
}

// CheckinCalendar 签到日历。对齐 CheckinServiceImpl.getCalendar。
func (s *service) CheckinCalendar(userID int64, year, month int) (*CheckinCalendarVO, error) {
	startDate := time.Date(year, time.Month(month), 1, 0, 0, 0, 0, time.Local)
	endDate := startDate.AddDate(0, 1, -1)

	records, err := s.repo.ListCheckinBetween(userID, startDate, endDate)
	if err != nil {
		return nil, err
	}
	dates := make([]string, 0, len(records))
	for _, r := range records {
		dates = append(dates, r.CheckinDate.Format(dateLayout))
	}
	return &CheckinCalendarVO{Dates: dates}, nil
}

// ---- 内部辅助 ----

// requireUser 读取用户，不存在返回 ecode.AccountNotFound。对齐 PointsServiceImpl.requireUser。
func (s *service) requireUser(userID int64) (*model.SysUser, error) {
	user, err := s.repo.FindUser(userID)
	if err != nil {
		return nil, err
	}
	if user == nil {
		return nil, ecode.AccountNotFound
	}
	return user, nil
}

// configInt 读取整型配置，未配置或解析失败返回默认值。对齐 CheckinServiceImpl.getConfigInt。
func (s *service) configInt(key string, defaultValue int) int {
	val, err := s.repo.FindConfigValue(key)
	if err != nil || val == nil {
		return defaultValue
	}
	n, err := strconv.Atoi(strings.TrimSpace(*val))
	if err != nil {
		s.logWarnf("配置项解析失败: key=%s, value=%s, 使用默认值: %d", key, *val, defaultValue)
		return defaultValue
	}
	return n
}

func (s *service) logf(format string, args ...interface{}) {
	if s.logger != nil {
		s.logger.Infof(format, args...)
	}
}

func (s *service) logWarnf(format string, args ...interface{}) {
	if s.logger != nil {
		s.logger.Warnf(format, args...)
	}
}

// assertPositiveAmount 积分变动金额必须 > 0，否则返回 BadRequest。对齐 assertPositiveAmount。
func assertPositiveAmount(amount int) error {
	if amount <= 0 {
		return ecode.BadRequest.WithMessage("积分变动金额必须大于0")
	}
	return nil
}

// newTransaction 构造一条积分流水（amount 已带正负号；签到/加分为正，扣分为负）。
func newTransaction(userID int64, amount, balanceAfter, txType int, bizID *int64, remark string) *model.PointsTransaction {
	return &model.PointsTransaction{
		UserID:       userID,
		Amount:       amount,
		BalanceAfter: balanceAfter,
		Type:         txType,
		BizID:        bizID,
		Remark:       remark,
	}
}

// today 返回今日零点（本地时区），对齐 LocalDate.now()（签到按日期匹配）。
func today() time.Time {
	now := time.Now()
	return time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.Local)
}

// parseDateTime 解析 yyyy-MM-dd HH:mm:ss；空串或格式错误返回 ok=false（对齐 StringUtils.hasText 守卫）。
func parseDateTime(s string) (time.Time, bool) {
	if strings.TrimSpace(s) == "" {
		return time.Time{}, false
	}
	t, err := time.ParseInLocation(dateTimeLayout, s, time.Local)
	if err != nil {
		return time.Time{}, false
	}
	return t, true
}

// toTransactionVOList 批量转换流水 VO。
func toTransactionVOList(records []model.PointsTransaction) []PointsTransactionVO {
	out := make([]PointsTransactionVO, 0, len(records))
	for i := range records {
		out = append(out, toTransactionVO(&records[i]))
	}
	return out
}

// toTransactionVO 转换单条流水 VO。对齐 PointsServiceImpl.toTransactionVO。
func toTransactionVO(t *model.PointsTransaction) PointsTransactionVO {
	return PointsTransactionVO{
		ID:           t.ID,
		UserID:       t.UserID,
		Amount:       t.Amount,
		BalanceAfter: t.BalanceAfter,
		Type:         t.Type,
		TypeName:     TxTypeName(t.Type),
		BizID:        t.BizID,
		Remark:       t.Remark,
		CreateTime:   t.CreateTime,
	}
}
