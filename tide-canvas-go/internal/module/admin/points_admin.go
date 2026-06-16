package admin

import (
	"strings"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"

	"github.com/tidecanvas/tide-canvas-go/internal/module/points"
	"github.com/tidecanvas/tide-canvas-go/pkg/ecode"
	"github.com/tidecanvas/tide-canvas-go/pkg/response"
)

// PointsService 管理端积分操作所需的最小能力（由 router 注入 points.Service）。
//
// 跨模块依赖：本模块不直接耦合 points 的具体实现，仅依赖此接口。
// 管理员调整 / 任务退款的 txType 取 points 包导出常量（points.TxAdminAdjust / points.TxAIRefund）。
type PointsService interface {
	// AddPoints 加积分并写流水（自带独立事务）。amount 必须 > 0；bizID 可空。
	AddPoints(userID int64, amount, txType int, bizID *int64, remark string) error
	// DeductPoints 扣积分并写流水（自带独立事务）。余额不足返回 ecode.PointsInsufficient。
	DeductPoints(userID int64, amount, txType int, bizID *int64, remark string) error
	// AddPointsTx / DeductPointsTx 在调用方已开启的事务 tx 内加 / 扣积分（同一物理事务），
	// 用于任务退款等「积分变动 + 防重/状态写入」须原子的场景。
	AddPointsTx(tx *gorm.DB, userID int64, amount, txType int, bizID *int64, remark string) error
	DeductPointsTx(tx *gorm.DB, userID int64, amount, txType int, bizID *int64, remark string) error
	// ListAllTransactions 管理端分页查询全部积分流水（q.UserID 非空则按用户过滤）。
	ListAllTransactions(q *points.TransactionQuery) ([]points.PointsTransactionVO, int64, error)
}

// 编译期断言：points.Service 满足本模块所需的 PointsService 子集。
var _ PointsService = (points.Service)(nil)

// PointsAdminService 积分管理服务（忠实迁移 AdminPointsController）。
type PointsAdminService struct {
	repo   *Repository
	points PointsService
}

// NewPointsAdminService 构造。pointsSvc 由 router 注入 points.Service。
func NewPointsAdminService(repo *Repository, pointsSvc PointsService) *PointsAdminService {
	return &PointsAdminService{repo: repo, points: pointsSvc}
}

// ListTransactions 积分交易记录分页（对齐 listTransactions → pointsService.listAllTransactions）。
// 注意：旧版 AdminPointsQuery.userId 为内部主键；此处入参 q.UserID 已由 handler 解析为内部主键。
func (s *PointsAdminService) ListTransactions(q *points.TransactionQuery) ([]points.PointsTransactionVO, int64, error) {
	return s.points.ListAllTransactions(q)
}

// Adjust 手动调整用户积分（对齐 adjust）：amount>=0 加分、<0 扣分，txType=管理员调整。
// userPublicID 为用户 public_id；内部解析为主键后调用积分服务。
func (s *PointsAdminService) Adjust(userPublicID string, amount int, remark string) error {
	user, err := s.repo.FindUserByPublicID(userPublicID)
	if err != nil {
		return err
	}
	if user == nil {
		return ecode.NotFound.WithMessage("用户不存在")
	}
	if amount >= 0 {
		return s.points.AddPoints(user.ID, amount, points.TxAdminAdjust, nil, remark)
	}
	return s.points.DeductPoints(user.ID, -amount, points.TxAdminAdjust, nil, remark)
}

// RefundTask 对失败 AI 任务退还积分（对齐 refundTask）。
// taskPublicID 为任务 public_id；按该任务实际 AI 消耗扣分全额退还，自动防重复。返回退款积分数。
//
// 迁移说明：旧版用单个 @Transactional 包裹「锁任务 + 防重校验 + 退款」。Go 侧在同一 db.Transaction 内
// 行锁读任务 → 防重计数 → 汇总扣分 → AddPointsTx 加分写流水，保证防重计数与加分严格原子：
// 行锁持有期间并发重复退款请求阻塞，提交后再请求时 refunded>0 被拒，彻底杜绝重复退款。
func (s *PointsAdminService) RefundTask(taskPublicID, reason string) (int, error) {
	r := blankToDefault(strings.TrimSpace(reason), "无")
	var refund int
	err := s.repo.DB().Transaction(func(tx *gorm.DB) error {
		task, err := s.repo.LockTaskByPublicIDForUpdate(tx, taskPublicID)
		if err != nil {
			return err
		}
		if task == nil {
			return ecode.NotFound.WithMessage("任务不存在")
		}
		// 防重：该任务已退过积分则拒绝
		refunded, err := s.repo.CountTransactionsByBizType(tx, task.ID, points.TxAIRefund)
		if err != nil {
			return err
		}
		if refunded > 0 {
			return ecode.BadRequest.WithMessage("该任务已退过积分，请勿重复操作")
		}
		// 退款金额 = 该任务 AI 消耗扣分之和（绝对值）
		sum, err := s.repo.SumConsumeByBizType(tx, task.ID, points.TxAIConsume)
		if err != nil {
			return err
		}
		if sum <= 0 {
			return ecode.BadRequest.WithMessage("该任务无扣分记录，无需退款")
		}
		// 同一事务内加分 + 写退款流水（与上面的防重计数原子）
		bizID := task.ID
		if err := s.points.AddPointsTx(tx, task.UserID, sum, points.TxAIRefund, &bizID, "管理员退款: "+r); err != nil {
			return err
		}
		refund = sum
		return nil
	})
	if err != nil {
		return 0, err
	}
	return refund, nil
}

// ---- HTTP handlers（挂载于 /api/admin/points，已 JWTAuth + AdminOnly）----

// listTransactions GET /api/admin/points/transactions 积分交易记录分页。
func (h *Handler) listTransactions(c *gin.Context) {
	var q points.TransactionQuery
	if err := c.ShouldBindQuery(&q); err != nil {
		response.Fail(c, ecode.BadRequest)
		return
	}
	records, total, err := h.pointsSvc.ListTransactions(&q)
	if err != nil {
		response.FailErr(c, err)
		return
	}
	response.OK(c, response.Page(records, total, q.PageNum, q.PageSize))
}

// adjustPoints POST /api/admin/points/adjust 手动调整用户积分。
func (h *Handler) adjustPoints(c *gin.Context) {
	var dto PointsAdjustDTO
	if err := c.ShouldBindJSON(&dto); err != nil {
		response.Fail(c, ecode.BadRequest)
		return
	}
	if strings.TrimSpace(dto.UserID) == "" {
		response.Fail(c, ecode.BadRequest.WithMessage("用户ID不能为空"))
		return
	}
	if dto.Amount == nil {
		response.Fail(c, ecode.BadRequest.WithMessage("调整金额不能为空"))
		return
	}
	if err := h.pointsSvc.Adjust(dto.UserID, *dto.Amount, dto.Remark); err != nil {
		response.FailErr(c, err)
		return
	}
	response.OK(c, nil)
}

// refundTask POST /api/admin/points/refund-task 对失败任务退还积分，返回退款积分数。
func (h *Handler) refundTask(c *gin.Context) {
	var dto TaskRefundDTO
	if err := c.ShouldBindJSON(&dto); err != nil {
		response.Fail(c, ecode.BadRequest)
		return
	}
	if strings.TrimSpace(dto.TaskID) == "" {
		response.Fail(c, ecode.BadRequest.WithMessage("任务ID不能为空"))
		return
	}
	refund, err := h.pointsSvc.RefundTask(dto.TaskID, dto.Reason)
	if err != nil {
		response.FailErr(c, err)
		return
	}
	response.OK(c, refund)
}
