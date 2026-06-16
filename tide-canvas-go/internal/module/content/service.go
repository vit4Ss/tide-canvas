package content

import (
	"github.com/sirupsen/logrus"

	"github.com/tidecanvas/tide-canvas-go/pkg/ecode"
)

// Service 内容审核业务（对齐 AdminContentController）。业务错误返回 *ecode.Error。
type Service struct {
	repo   *Repository
	logger *logrus.Logger
}

// NewService 构造。logger 可为 nil。
func NewService(repo *Repository, logger *logrus.Logger) *Service {
	return &Service{repo: repo, logger: logger}
}

// List 公开作品分页（对齐 list）：查 canvas_project，再批量补齐归属用户展示名。
// 归属名解析失败不影响列表返回（回退空名，对齐数据面板各聚合的容错思路）。
func (s *Service) List(q *ContentQuery) ([]ContentVO, int64, error) {
	q.normalize()
	records, total, err := s.repo.PageContents(q)
	if err != nil {
		return nil, 0, err
	}

	// 批量解析归属用户展示名（去重 user_id）。
	idSet := make(map[int64]struct{}, len(records))
	for i := range records {
		idSet[records[i].UserID] = struct{}{}
	}
	ids := make([]int64, 0, len(idSet))
	for id := range idSet {
		ids = append(ids, id)
	}
	names, err := s.repo.OwnerNamesByIDs(ids)
	if err != nil {
		// 名称解析失败仅记日志并回退空名，不让审核列表整体 500。
		if s.logger != nil {
			s.logger.WithError(err).Warn("[content] 解析作品归属用户名失败，回退空名")
		}
		names = map[int64]string{}
	}

	vos := make([]ContentVO, 0, len(records))
	for i := range records {
		p := &records[i]
		vos = append(vos, ContentVO{
			ID:         p.PublicID,
			Name:       p.Name,
			Thumbnail:  p.Thumbnail,
			OwnerName:  names[p.UserID],
			Status:     p.Status,
			CreateTime: p.CreateTime,
		})
	}
	return vos, total, nil
}

// Audit 审核改状态（对齐 audit）：按 public_id 定位作品，更新 status。
// 作品不存在返回 404；status 缺省（前端未传）则视为无效请求。
func (s *Service) Audit(publicID string, req *AuditReq) error {
	if req.Status == nil {
		return ecode.BadRequest
	}
	project, err := s.repo.FindByPublicID(publicID)
	if err != nil {
		return err
	}
	if project == nil {
		return ecode.NotFound.WithMessage("内容不存在")
	}
	return s.repo.UpdateStatus(project.ID, *req.Status)
}
