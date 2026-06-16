package banner

import (
	"github.com/tidecanvas/tide-canvas-go/internal/model"
	"github.com/tidecanvas/tide-canvas-go/pkg/ecode"
)

// Service Banner 业务逻辑。旧版无独立 service（直接用 mapper），此处按 guide 收口到 service 层。
type Service struct {
	repo *Repository
}

// NewService 构造。
func NewService(repo *Repository) *Service { return &Service{repo: repo} }

// ListEnabled 首页轮播：启用中的 Banner，按 sort_order 升序。
func (s *Service) ListEnabled() ([]*BannerVO, error) {
	list, err := s.repo.ListEnabled()
	if err != nil {
		return nil, err
	}
	return toVOList(list), nil
}

// ListAll 管理端：全部 Banner，按 sort_order 升序。
func (s *Service) ListAll() ([]*BannerVO, error) {
	list, err := s.repo.ListAll()
	if err != nil {
		return nil, err
	}
	return toVOList(list), nil
}

// Create 新增 Banner：sortOrder 缺省 0，status 缺省 1（对齐 AdminBannerController.create）。
func (s *Service) Create(req *CreateReq) (*BannerVO, error) {
	sortOrder := 0
	if req.SortOrder != nil {
		sortOrder = *req.SortOrder
	}
	status := 1
	if req.Status != nil {
		status = *req.Status
	}
	b := &model.SysBanner{
		Title:     req.Title,
		ImageURL:  req.ImageURL,
		LinkURL:   req.LinkURL,
		SortOrder: sortOrder,
		Status:    status,
	}
	if err := s.repo.Create(b); err != nil {
		return nil, err
	}
	return toVO(b), nil
}

// Update 更新 Banner：仅非 nil 字段参与更新（对齐 AdminBannerController.update）；不存在返回 404。
func (s *Service) Update(id int64, req *UpdateReq) error {
	b, err := s.repo.FindByID(id)
	if err != nil {
		return err
	}
	if b == nil {
		return ecode.NotFound
	}
	if req.Title != nil {
		b.Title = *req.Title
	}
	if req.ImageURL != nil {
		b.ImageURL = *req.ImageURL
	}
	if req.LinkURL != nil {
		b.LinkURL = *req.LinkURL
	}
	if req.SortOrder != nil {
		b.SortOrder = *req.SortOrder
	}
	if req.Status != nil {
		b.Status = *req.Status
	}
	return s.repo.Save(b)
}

// Delete 删除 Banner（逻辑删除，对齐 AdminBannerController.delete）。
func (s *Service) Delete(id int64) error {
	return s.repo.DeleteByID(id)
}

func toVO(b *model.SysBanner) *BannerVO {
	return &BannerVO{
		ID:         b.ID,
		Title:      b.Title,
		ImageURL:   b.ImageURL,
		LinkURL:    b.LinkURL,
		SortOrder:  b.SortOrder,
		Status:     b.Status,
		CreateTime: b.CreateTime,
	}
}

func toVOList(list []model.SysBanner) []*BannerVO {
	out := make([]*BannerVO, 0, len(list))
	for i := range list {
		out = append(out, toVO(&list[i]))
	}
	return out
}
