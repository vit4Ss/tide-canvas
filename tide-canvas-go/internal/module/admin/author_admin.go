package admin

import (
	"github.com/gin-gonic/gin"

	"github.com/tidecanvas/tide-canvas-go/pkg/ecode"
	"github.com/tidecanvas/tide-canvas-go/pkg/response"
)

// AuthorAdminService 作者管理服务（忠实迁移 AdminAuthorServiceImpl）。
type AuthorAdminService struct {
	repo *Repository
}

// NewAuthorAdminService 构造。
func NewAuthorAdminService(repo *Repository) *AuthorAdminService {
	return &AuthorAdminService{repo: repo}
}

// ListAuthors 作者分页列表（对齐 listAuthors）：is_author=1，关键词匹配用户名。
func (s *AuthorAdminService) ListAuthors(q *UserQuery) ([]UserVO, int64, error) {
	q.normalize()
	records, total, err := s.repo.PageAuthors(q)
	if err != nil {
		return nil, 0, err
	}
	return toUserVOList(records), total, nil
}

// GrantAuthor 授予作者权限（对齐 grantAuthor）；按 public_id 定位。
func (s *AuthorAdminService) GrantAuthor(publicID string) error {
	return s.setAuthorFlag(publicID, 1)
}

// RevokeAuthor 撤销作者权限（对齐 revokeAuthor）；按 public_id 定位。
func (s *AuthorAdminService) RevokeAuthor(publicID string) error {
	return s.setAuthorFlag(publicID, 0)
}

func (s *AuthorAdminService) setAuthorFlag(publicID string, flag int) error {
	user, err := s.repo.FindUserByPublicID(publicID)
	if err != nil {
		return err
	}
	if user == nil {
		return ecode.NotFound.WithMessage("用户不存在")
	}
	return s.repo.UpdateUserColumns(user.ID, map[string]interface{}{"is_author": flag})
}

// ---- HTTP handlers（挂载于 /api/admin/authors，已 JWTAuth + AdminOnly）----

// listAuthors GET /api/admin/authors 作者列表。
func (h *Handler) listAuthors(c *gin.Context) {
	var q UserQuery
	if err := c.ShouldBindQuery(&q); err != nil {
		response.Fail(c, ecode.BadRequest)
		return
	}
	records, total, err := h.authorSvc.ListAuthors(&q)
	if err != nil {
		response.FailErr(c, err)
		return
	}
	response.OK(c, response.Page(records, total, q.PageNum, q.PageSize))
}

// grantAuthor POST /api/admin/authors/:id/grant 授予作者（:id 为 public_id）。
func (h *Handler) grantAuthor(c *gin.Context) {
	if err := h.authorSvc.GrantAuthor(c.Param("id")); err != nil {
		response.FailErr(c, err)
		return
	}
	response.OK(c, nil)
}

// revokeAuthor POST /api/admin/authors/:id/revoke 撤销作者（:id 为 public_id）。
func (h *Handler) revokeAuthor(c *gin.Context) {
	if err := h.authorSvc.RevokeAuthor(c.Param("id")); err != nil {
		response.FailErr(c, err)
		return
	}
	response.OK(c, nil)
}
