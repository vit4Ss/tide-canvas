package redeem

import (
	"crypto/rand"
	"math/big"
	"strconv"
	"strings"
	"time"

	"github.com/sirupsen/logrus"
	"gorm.io/gorm"

	"github.com/tidecanvas/tide-canvas-go/internal/model"
	"github.com/tidecanvas/tide-canvas-go/internal/module/points"
	"github.com/tidecanvas/tide-canvas-go/pkg/ecode"
)

// PointsService 兑换发放积分所需的最小能力（由 router 注入 points.Service）。
//
// 跨模块依赖：本模块不直接耦合 points 的具体实现，仅依赖此接口。
// txType 取 points 包导出常量 points.TxRedeem。
type PointsService interface {
	// AddPoints 加积分并写流水。amount 必须 > 0；bizID 可空。
	AddPoints(userID int64, amount, txType int, bizID *int64, remark string) error
	// AddPointsTx 在调用方事务 tx 内加积分并写流水（与兑换码标记已用同一物理事务）。
	AddPointsTx(tx *gorm.DB, userID int64, amount, txType int, bizID *int64, remark string) error
	// GetBalance 查询积分余额（用于返回兑换后余额）。
	GetBalance(userID int64) (*points.PointsBalanceVO, error)
}

// 编译期断言：points.Service 满足本模块所需的 PointsService 子集。
var _ PointsService = (points.Service)(nil)

// Service 兑换码服务（忠实迁移 RedeemServiceImpl）。
type Service struct {
	repo   *Repository
	points PointsService
	logger *logrus.Logger
}

// NewService 构造兑换码服务。pointsSvc 由 router 注入 points.Service。logger 可为 nil。
func NewService(repo *Repository, pointsSvc PointsService, logger *logrus.Logger) *Service {
	return &Service{repo: repo, points: pointsSvc, logger: logger}
}

// Redeem 用户兑换：校验码并发放积分（事务）。对齐 RedeemServiceImpl.redeem。
func (s *Service) Redeem(userID int64, code string) (*RedeemResultVO, error) {
	if strings.TrimSpace(code) == "" {
		return nil, ecode.RedeemCodeInvalid
	}
	normalized := strings.ToUpper(strings.TrimSpace(code))

	var amount int
	err := s.repo.DB().Transaction(func(tx *gorm.DB) error {
		// 悲观锁锁定该码行，防止并发重复兑换
		rc, err := s.repo.LockByCodeForUpdate(tx, normalized)
		if err != nil {
			return err
		}
		if rc == nil {
			return ecode.RedeemCodeInvalid
		}
		if rc.Status == StatusDisabled {
			return ecode.RedeemCodeDisabled
		}
		if rc.Status == StatusUsed {
			return ecode.RedeemCodeUsed
		}
		if rc.ExpireTime != nil && rc.ExpireTime.Before(time.Now()) {
			return ecode.RedeemCodeExpired
		}

		// 标记已用
		now := time.Now()
		rc.Status = StatusUsed
		rc.UsedBy = &userID
		rc.UsedTime = &now
		if err := s.repo.MarkUsed(tx, rc); err != nil {
			return err
		}

		// 发放积分：用 *Tx 变体复用本外层事务，与 MarkUsed 同一物理事务（原子：码状态与积分同提交/同回滚）。
		amount = rc.Points
		if amount > 0 {
			if err := s.points.AddPointsTx(tx, userID, amount, points.TxRedeem, &rc.ID, "兑换码兑换: "+normalized); err != nil {
				return err
			}
		}
		s.logf("兑换成功: userId=%d, code=%s, points=%d", userID, normalized, amount)
		return nil
	})
	if err != nil {
		return nil, err
	}

	result := &RedeemResultVO{Points: amount}
	if balance, err := s.points.GetBalance(userID); err == nil && balance != nil {
		b := balance.Points
		result.Balance = &b
	}
	return result, nil
}

// Generate 管理端批量生成兑换码，返回生成的码列表（事务）。对齐 RedeemServiceImpl.generate。
// creatorID 为当前管理员用户ID（由 handler 从 JWT 注入），可空。
func (s *Service) Generate(creatorID *int64, req *GenerateRedeemReq) ([]string, error) {
	// count: 默认 1，范围 [1, 1000]（对齐 Math.min(Math.max(count,1),1000)）。
	count := 1
	if req.Count != nil {
		count = *req.Count
	}
	if count < 1 {
		count = 1
	}
	if count > maxGenerateCount {
		count = maxGenerateCount
	}
	// points: 默认 0（对齐 dto.getPoints()==null?0:...）。
	pts := 0
	if req.Points != nil {
		pts = *req.Points
	}

	expireTime, err := parseExpireTime(req.ExpireTime)
	if err != nil {
		return nil, err
	}

	batchNo := "B" + strconv.FormatInt(time.Now().UnixMilli(), 10)
	codes := make([]string, 0, count)
	err = s.repo.DB().Transaction(func(tx *gorm.DB) error {
		for i := 0; i < count; i++ {
			code, err := s.uniqueCode()
			if err != nil {
				return err
			}
			rc := &model.RedeemCode{
				Code:       code,
				Points:     pts,
				CreatedBy:  creatorID,
				Status:     StatusUnused,
				ExpireTime: expireTime,
				BatchNo:    batchNo,
				Remark:     req.Remark,
			}
			if err := tx.Create(rc).Error; err != nil {
				return err
			}
			codes = append(codes, code)
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	s.logf("生成兑换码: batch=%s, count=%d, points=%d", batchNo, count, pts)
	return codes, nil
}

// List 管理端分页查询。对齐 RedeemServiceImpl.list。
func (s *Service) List(q *RedeemCodeQuery) ([]RedeemCodeVO, int64, error) {
	q.normalize()
	records, total, err := s.repo.Page(q)
	if err != nil {
		return nil, 0, err
	}
	names, err := s.repo.UserDisplayNames(redeemUserIDs(records))
	if err != nil {
		return nil, 0, err
	}
	return toVOList(records, names), total, nil
}

// UpdateStatus 启用(0)/停用(2)。对齐 RedeemServiceImpl.updateStatus。
func (s *Service) UpdateStatus(id int64, status int) error {
	rc, err := s.repo.FindByID(id)
	if err != nil {
		return err
	}
	if rc == nil {
		return ecode.NotFound
	}
	return s.repo.UpdateStatus(id, status)
}

// Delete 删除兑换码（逻辑删除）。对齐 RedeemServiceImpl.delete。
func (s *Service) Delete(id int64) error {
	return s.repo.Delete(id)
}

// ---- 内部辅助 ----

// uniqueCode 生成全站唯一的兑换码，最多重试 uniqueRetry 次；极低概率兜底拼接纳秒尾数。
// 对齐 RedeemServiceImpl.uniqueCode。
func (s *Service) uniqueCode() (string, error) {
	for attempt := 0; attempt < uniqueRetry; attempt++ {
		code, err := randomCode()
		if err != nil {
			return "", err
		}
		exist, err := s.repo.ExistsByCode(code)
		if err != nil {
			return "", err
		}
		if !exist {
			return code, nil
		}
	}
	// 极低概率兜底（对齐 randomCode() + (System.nanoTime() % 100)）。
	code, err := randomCode()
	if err != nil {
		return "", err
	}
	return code + strconv.FormatInt(time.Now().UnixNano()%100, 10), nil
}

// randomCode 生成定长随机兑换码（SecureRandom 等价：crypto/rand）。对齐 RedeemServiceImpl.randomCode。
func randomCode() (string, error) {
	var sb strings.Builder
	sb.Grow(codeLen)
	max := big.NewInt(int64(len(codeChars)))
	for i := 0; i < codeLen; i++ {
		n, err := rand.Int(rand.Reader, max)
		if err != nil {
			return "", err
		}
		sb.WriteByte(codeChars[n.Int64()])
	}
	return sb.String(), nil
}

// parseExpireTime 解析有效期：空串=永久(nil)；格式错误返回 BadRequest（对齐旧 @JsonFormat 失败即 400）。
func parseExpireTime(s string) (*time.Time, error) {
	if strings.TrimSpace(s) == "" {
		return nil, nil
	}
	t, err := time.ParseInLocation(expireTimeLayout, strings.TrimSpace(s), time.Local)
	if err != nil {
		return nil, ecode.BadRequest.WithMessage("有效期格式错误，应为 yyyy-MM-dd HH:mm:ss")
	}
	return &t, nil
}

func (s *Service) logf(format string, args ...interface{}) {
	if s.logger != nil {
		s.logger.Infof(format, args...)
	}
}

// toVOList 批量转换兑换码 VO。
func toVOList(records []model.RedeemCode, names map[int64]string) []RedeemCodeVO {
	out := make([]RedeemCodeVO, 0, len(records))
	for i := range records {
		out = append(out, toVO(&records[i], names))
	}
	return out
}

// toVO 转换单条兑换码 VO（对齐 BeanUtils.copyProperties）。
func toVO(rc *model.RedeemCode, names map[int64]string) RedeemCodeVO {
	creatorName := ""
	if rc.CreatedBy != nil {
		creatorName = names[*rc.CreatedBy]
	}
	userName := ""
	if rc.UsedBy != nil {
		userName = names[*rc.UsedBy]
	}
	return RedeemCodeVO{
		ID:          rc.ID,
		Code:        rc.Code,
		Points:      rc.Points,
		CreatedBy:   rc.CreatedBy,
		CreatorName: creatorName,
		Status:      rc.Status,
		UsedBy:      rc.UsedBy,
		UserName:    userName,
		UsedTime:    rc.UsedTime,
		ExpireTime:  rc.ExpireTime,
		BatchNo:     rc.BatchNo,
		Remark:      rc.Remark,
		CreateTime:  rc.CreateTime,
	}
}

func redeemUserIDs(records []model.RedeemCode) []int64 {
	seen := make(map[int64]struct{})
	ids := make([]int64, 0, len(records))
	for i := range records {
		for _, id := range []*int64{records[i].CreatedBy, records[i].UsedBy} {
			if id == nil {
				continue
			}
			if _, ok := seen[*id]; ok {
				continue
			}
			seen[*id] = struct{}{}
			ids = append(ids, *id)
		}
	}
	return ids
}
