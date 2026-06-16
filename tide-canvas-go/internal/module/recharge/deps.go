package recharge

import (
	"github.com/sirupsen/logrus"
	"gorm.io/gorm"

	"github.com/tidecanvas/tide-canvas-go/internal/module/points"
)

// PointsService 积分能力依赖（对齐旧 PointsService.addPoints）。
// 支付成功 / 管理端手动确认入账时调用 AddPoints 加积分并写流水（含行锁 + 事务）。
// 由 router.New 注入 points 模块的真实实现（points.Service 已实现该方法）。
//
// txType 取 points 包的充值常量（points.TxRecharge=1）；bizID 传订单主键；remark 为充值订单备注。
type PointsService interface {
	AddPoints(userID int64, amount, txType int, bizID *int64, remark string) error
	// AddPointsTx 在调用方事务 tx 内加积分并写流水（与订单「→已支付」状态更新同一物理事务）。
	AddPointsTx(tx *gorm.DB, userID int64, amount, txType int, bizID *int64, remark string) error
}

// 编译期断言：points.Service 满足本模块所需的 PointsService（含 *Tx 变体）。
var _ PointsService = (points.Service)(nil)

// noopLogger 占位日志（logger 为 nil 时使用），避免散落 nil 判断。
type noopLogger struct{}

func (noopLogger) Infof(string, ...interface{})  {}
func (noopLogger) Warnf(string, ...interface{})  {}
func (noopLogger) Errorf(string, ...interface{}) {}

// logger 抽象出本模块用到的日志方法，便于注入 *logrus.Logger 或空实现。
type logger interface {
	Infof(format string, args ...interface{})
	Warnf(format string, args ...interface{})
	Errorf(format string, args ...interface{})
}

// resolveLogger 将可空的 *logrus.Logger 归一为非空 logger。
func resolveLogger(l *logrus.Logger) logger {
	if l == nil {
		return noopLogger{}
	}
	return l
}
