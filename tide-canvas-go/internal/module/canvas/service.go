package canvas

import (
	"crypto/rand"
	"math/big"
	"strings"

	"github.com/google/uuid"

	"github.com/tidecanvas/tide-canvas-go/internal/model"
	"github.com/tidecanvas/tide-canvas-go/pkg/ecode"
)

// tokenAlphabet URL token 字符集，剔除易混淆字符（0/O/1/l/I）。
const tokenAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789"

// tokenLength 生成的 url_token 长度。
const tokenLength = 12

// maxThumbnailLen thumbnail 列长度上限（VARCHAR(512)）。
const maxThumbnailLen = 512

// Service 画布项目业务逻辑（对齐 ProjectServiceImpl）。
type Service struct {
	repo  *Repository
	team  TeamProvider
	users UserFinder
}

// NewService 构造。team / users 为跨模块依赖（见 deps.go）：
// team 注入 team.Service（或 DefaultTeamProvider 降级）；users 注入 NewDBUserFinder(db)。
func NewService(repo *Repository, team TeamProvider, users UserFinder) *Service {
	return &Service{repo: repo, team: team, users: users}
}

// ListProjects 团队可见项目分页（对齐 listProjects）。
func (s *Service) ListProjects(userID int64, query *ProjectQuery) (*pageData, error) {
	query.normalize()
	ownerIDs, err := s.team.GetTeamMemberIDs(userID)
	if err != nil {
		return nil, err
	}
	records, total, err := s.repo.Page(ownerIDs, query.Keyword, query.Status, query.PageNum, query.PageSize)
	if err != nil {
		return nil, err
	}
	vos, err := s.toProjectVOs(records)
	if err != nil {
		return nil, err
	}
	return &pageData{Records: vos, Total: total, PageNum: query.PageNum, PageSize: query.PageSize}, nil
}

// pageData 服务层分页载荷，由 handler 转交 response.Page 输出。
type pageData struct {
	Records  []*ProjectVO
	Total    int64
	PageNum  int
	PageSize int
}

// CreateProject 创建项目（对齐 createProject）：默认 status=0 / isPublic=0 / canvasData="{}"，生成唯一 url_token。
func (s *Service) CreateProject(userID int64, req *ProjectCreateReq) (*ProjectVO, error) {
	token, err := s.generateURLToken()
	if err != nil {
		return nil, err
	}
	project := &model.CanvasProject{
		UserID:      userID,
		Name:        req.Name,
		Description: req.Description,
		Status:      0,
		IsPublic:    0,
		CanvasData:  "{}",
		URLToken:    token,
	}
	if err := s.repo.Create(project); err != nil {
		return nil, err
	}
	return s.toProjectVO(project)
}

// GetProject 项目详情（对齐 getProject）：按 public_id 取并校验访问权。
func (s *Service) GetProject(userID int64, publicID string) (*ProjectDetailVO, error) {
	project, err := s.getAndCheck(userID, publicID)
	if err != nil {
		return nil, err
	}
	return s.toDetailVO(project)
}

// GetProjectByToken 按 URL token 获取项目详情（对齐 getProjectByToken）。
func (s *Service) GetProjectByToken(userID int64, urlToken string) (*ProjectDetailVO, error) {
	if strings.TrimSpace(urlToken) == "" {
		return nil, ecode.NotFound.WithMessage("项目不存在")
	}
	project, err := s.repo.FindByURLToken(urlToken)
	if err != nil {
		return nil, err
	}
	if project == nil {
		return nil, ecode.NotFound.WithMessage("项目不存在")
	}
	if ok, err := s.canAccess(userID, project.UserID); err != nil {
		return nil, err
	} else if !ok {
		return nil, ecode.Forbidden.WithMessage("无权访问该项目")
	}
	return s.toDetailVO(project)
}

// UpdateProject 更新项目（对齐 updateProject）：仅更新传入字段。
func (s *Service) UpdateProject(userID int64, publicID string, req *ProjectUpdateReq) (*ProjectVO, error) {
	project, err := s.getAndCheck(userID, publicID)
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(req.Name) != "" {
		project.Name = req.Name
	}
	if req.Description != nil {
		project.Description = *req.Description
	}
	if req.Status != nil {
		project.Status = *req.Status
	}
	if req.IsPublic != nil {
		if *req.IsPublic {
			project.IsPublic = 1
		} else {
			project.IsPublic = 0
		}
	}
	if err := s.repo.Save(project); err != nil {
		return nil, err
	}
	return s.toProjectVO(project)
}

// DeleteProject 删除项目（对齐 deleteProject）：仅所有者或团队管理员可删（成员可看/编辑共享项目，但不能删）。
func (s *Service) DeleteProject(userID int64, publicID string) error {
	project, err := s.repo.FindByPublicID(publicID)
	if err != nil {
		return err
	}
	if project == nil {
		return ecode.NotFound.WithMessage("项目不存在")
	}
	if project.UserID != userID {
		isAdmin, err := s.team.IsTeamAdminOf(userID, project.UserID)
		if err != nil {
			return err
		}
		if !isAdmin {
			return ecode.Forbidden.WithMessage("无权删除该项目")
		}
	}
	return s.repo.DeleteByID(project.ID)
}

// SaveCanvas 保存画布数据（对齐 saveCanvas）。
// thumbnail 仅接受 ≤512 的 http(s) 地址，其余（data:/blob: 或超长）忽略不覆盖原值，避免落库 Data too long。
func (s *Service) SaveCanvas(userID int64, publicID string, req *CanvasSaveReq) (*model.CanvasProject, error) {
	project, err := s.getAndCheck(userID, publicID)
	if err != nil {
		return nil, err
	}
	columns := map[string]interface{}{"canvas_data": req.CanvasData}
	thumbnail := req.Thumbnail
	if thumbnail != "" && len(thumbnail) <= maxThumbnailLen &&
		(strings.HasPrefix(thumbnail, "http://") || strings.HasPrefix(thumbnail, "https://")) {
		columns["thumbnail"] = thumbnail
	}
	if req.ExpectedUpdateTime != nil {
		ok, err := s.repo.UpdateColumnsIfUpdateTime(project.ID, *req.ExpectedUpdateTime, columns)
		if err != nil {
			return nil, err
		}
		if !ok {
			return nil, ecode.Conflict.WithMessage("画布已被其他窗口或成员更新，请刷新后再保存")
		}
	} else if err := s.repo.UpdateColumns(project.ID, columns); err != nil {
		return nil, err
	}
	return s.repo.FindByID(project.ID)
}

// GetCanvasData 获取画布数据（对齐 getCanvasData）。新建未保存的画布 canvas_data 可能为空，由 handler 兜底 "{}"。
func (s *Service) GetCanvasData(userID int64, publicID string) (*model.CanvasProject, error) {
	return s.getAndCheck(userID, publicID)
}

// ShareProject 生成分享链接（对齐 shareProject）：首次生成 share_token（无横杠 UUID），已存在则复用。
func (s *Service) ShareProject(userID int64, publicID string) (string, error) {
	project, err := s.getAndCheck(userID, publicID)
	if err != nil {
		return "", err
	}
	if strings.TrimSpace(project.ShareToken) == "" {
		token := simpleUUID()
		if err := s.repo.UpdateColumns(project.ID, map[string]interface{}{"share_token": token}); err != nil {
			return "", err
		}
		project.ShareToken = token
	}
	return project.ShareToken, nil
}

// getAndCheck 取项目并校验访问权：按 public_id 取，不存在 404；归属用户须在当前用户团队可见范围内，否则 403。
// （团队共享 → 成员可看/编辑；删除另在 DeleteProject 单独限所有者/管理员。）
func (s *Service) getAndCheck(userID int64, publicID string) (*model.CanvasProject, error) {
	project, err := s.repo.FindByPublicID(publicID)
	if err != nil {
		return nil, err
	}
	if project == nil {
		return nil, ecode.NotFound.WithMessage("项目不存在")
	}
	if ok, err := s.canAccess(userID, project.UserID); err != nil {
		return nil, err
	} else if !ok {
		return nil, ecode.Forbidden.WithMessage("无权访问该项目")
	}
	return project, nil
}

// canAccess 项目归属用户是否在当前用户团队可见范围内。
func (s *Service) canAccess(userID, ownerID int64) (bool, error) {
	ids, err := s.team.GetTeamMemberIDs(userID)
	if err != nil {
		return false, err
	}
	for _, id := range ids {
		if id == ownerID {
			return true, nil
		}
	}
	return false, nil
}

// generateURLToken 生成不透明随机短 token，并校验唯一性（极小概率冲突时重试）。
func (s *Service) generateURLToken() (string, error) {
	for attempt := 0; attempt < 5; attempt++ {
		token, err := randomToken(tokenLength)
		if err != nil {
			return "", err
		}
		exists, err := s.repo.ExistsByURLToken(token)
		if err != nil {
			return "", err
		}
		if !exists {
			return token, nil
		}
	}
	// 连续冲突的兜底：退化为更长的唯一串。
	return simpleUUID()[:16], nil
}

// randomToken 用密码学安全随机源从 tokenAlphabet 取 n 个字符。
func randomToken(n int) (string, error) {
	alphabetLen := big.NewInt(int64(len(tokenAlphabet)))
	sb := strings.Builder{}
	sb.Grow(n)
	for i := 0; i < n; i++ {
		idx, err := rand.Int(rand.Reader, alphabetLen)
		if err != nil {
			return "", err
		}
		sb.WriteByte(tokenAlphabet[idx.Int64()])
	}
	return sb.String(), nil
}

// simpleUUID 生成无横杠 UUID（对齐 hutool IdUtil.fastSimpleUUID）。
func simpleUUID() string {
	return strings.ReplaceAll(uuid.NewString(), "-", "")
}

// toProjectVO 单条概要 VO。
func (s *Service) toProjectVO(p *model.CanvasProject) (*ProjectVO, error) {
	vos, err := s.toProjectVOs([]model.CanvasProject{*p})
	if err != nil {
		return nil, err
	}
	return vos[0], nil
}

// toProjectVOs 批量概要 VO，并批量解析归属用户 public_id（避免逐行查询）。
func (s *Service) toProjectVOs(list []model.CanvasProject) ([]*ProjectVO, error) {
	if len(list) == 0 {
		return []*ProjectVO{}, nil
	}
	ownerIDSet := make(map[int64]struct{}, len(list))
	for i := range list {
		ownerIDSet[list[i].UserID] = struct{}{}
	}
	ownerIDs := make([]int64, 0, len(ownerIDSet))
	for id := range ownerIDSet {
		ownerIDs = append(ownerIDs, id)
	}
	ownerPublicIDs, err := s.users.PublicIDsByIDs(ownerIDs)
	if err != nil {
		return nil, err
	}

	vos := make([]*ProjectVO, 0, len(list))
	for i := range list {
		p := &list[i]
		vos = append(vos, &ProjectVO{
			ID:          p.PublicID,
			OwnerID:     ownerPublicIDs[p.UserID],
			Name:        p.Name,
			Description: p.Description,
			Thumbnail:   p.Thumbnail,
			Status:      p.Status,
			IsPublic:    p.IsPublic == 1,
			URLToken:    p.URLToken,
			CreateTime:  p.CreateTime,
			UpdateTime:  p.UpdateTime,
		})
	}
	return vos, nil
}

// toDetailVO 详情 VO（含 canvasData / shareToken）。
func (s *Service) toDetailVO(p *model.CanvasProject) (*ProjectDetailVO, error) {
	base, err := s.toProjectVO(p)
	if err != nil {
		return nil, err
	}
	return &ProjectDetailVO{
		ProjectVO:  *base,
		CanvasData: p.CanvasData,
		ShareToken: p.ShareToken,
	}, nil
}
