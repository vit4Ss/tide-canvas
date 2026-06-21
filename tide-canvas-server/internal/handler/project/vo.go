package project

import (
	"time"

	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/idgen"
)

// vo.go defines response payloads for project endpoints. JSON shapes mirror
// tide-canvas-web/src/types/canvas.ts. Every id field is an idgen.ID (string JSON).

// ProjectVO is the list/summary view of a project (tide-canvas-web ProjectVO).
type ProjectVO struct {
	ID          idgen.ID `json:"id"`
	OwnerID     idgen.ID `json:"ownerId"`
	Name        string   `json:"name"`
	Description string   `json:"description"`
	Thumbnail   string   `json:"thumbnail"`
	Status      int      `json:"status"`
	IsPublic    bool     `json:"isPublic"`
	UrlToken    string   `json:"urlToken"`
	CreateTime  string   `json:"createTime"`
	UpdateTime  string   `json:"updateTime"`
}

// UserSimpleVO is the minimal author view embedded in ProjectDetailVO
// (tide-canvas-web UserSimpleVO).
type UserSimpleVO struct {
	ID       idgen.ID `json:"id"`
	Username string   `json:"username"`
	Nickname string   `json:"nickname"`
	Avatar   string   `json:"avatar"`
}

// ProjectDetailVO is the full project view (tide-canvas-web ProjectDetailVO).
type ProjectDetailVO struct {
	ProjectVO
	CanvasData string       `json:"canvasData"`
	ShareToken string       `json:"shareToken"`
	Owner      UserSimpleVO `json:"owner"`
}

// CanvasDataVO is the response of GET /api/projects/:id/canvas.
type CanvasDataVO struct {
	CanvasData string `json:"canvasData"`
}

// ShareVO is the response of POST /api/projects/:id/share.
type ShareVO struct {
	ShareToken string `json:"shareToken"`
	ShareUrl   string `json:"shareUrl"`
}

// toProjectVO maps a persisted project to its summary VO.
func toProjectVO(p *model.Project) ProjectVO {
	return ProjectVO{
		ID:          p.ID,
		OwnerID:     p.OwnerID,
		Name:        p.Name,
		Description: p.Description,
		Thumbnail:   p.Thumbnail,
		Status:      p.Status,
		IsPublic:    p.IsPublic,
		UrlToken:    p.UrlToken,
		CreateTime:  formatTime(p.CreateTime),
		UpdateTime:  formatTime(p.UpdateTime),
	}
}

// toProjectDetailVO maps a project plus its owner to the detail VO.
func toProjectDetailVO(p *model.Project, owner *model.User) ProjectDetailVO {
	return ProjectDetailVO{
		ProjectVO:  toProjectVO(p),
		CanvasData: p.CanvasData,
		ShareToken: p.ShareToken,
		Owner:      toUserSimpleVO(owner),
	}
}

// toUserSimpleVO is a small helper for building the owner view.
func toUserSimpleVO(u *model.User) UserSimpleVO {
	if u == nil {
		return UserSimpleVO{}
	}
	return UserSimpleVO{
		ID:       u.ID,
		Username: u.Username,
		Nickname: u.Nickname,
		Avatar:   u.Avatar,
	}
}

// formatTime renders a time as RFC3339, or "" for the zero value.
func formatTime(t time.Time) string {
	if t.IsZero() {
		return ""
	}
	return t.Format(time.RFC3339)
}
