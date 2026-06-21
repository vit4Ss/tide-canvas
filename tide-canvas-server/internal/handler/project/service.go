package project

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"strings"

	"gorm.io/gorm"

	"tidecanvas/internal/config"
	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/idgen"
)

// service.go holds project business logic: ownership scoping, opaque token
// generation (url/share), canvas persistence and the shareable URL build.

// emptyCanvas is the canvas payload assigned to a freshly created project.
const emptyCanvas = "{}"

// Sentinel errors mapped to business codes by the handler.
var (
	errForbidden = errors.New("project: not owner")
)

type service struct {
	repo *repo
	cfg  *config.Config
}

func newService(db *gorm.DB, cfg *config.Config) *service {
	return &service{repo: newRepo(db), cfg: cfg}
}

// list returns a page of the authenticated owner's projects as summary VOs.
func (s *service) list(ownerID idgen.ID, q *ListQuery) ([]ProjectVO, int64, error) {
	rows, total, err := s.repo.list(ownerID, q)
	if err != nil {
		return nil, 0, err
	}
	vos := make([]ProjectVO, 0, len(rows))
	for i := range rows {
		vos = append(vos, toProjectVO(&rows[i]))
	}
	return vos, total, nil
}

// create makes a new empty project owned by ownerID.
func (s *service) create(ownerID idgen.ID, dto CreateDTO) (*ProjectVO, error) {
	p := &model.Project{
		ID:          idgen.Next(),
		OwnerID:     ownerID,
		Name:        strings.TrimSpace(dto.Name),
		Description: strings.TrimSpace(dto.Description),
		CanvasData:  emptyCanvas,
		Status:      0,
		IsPublic:    false,
		UrlToken:    genToken(),
	}
	if err := s.repo.create(p); err != nil {
		return nil, err
	}
	vo := toProjectVO(p)
	return &vo, nil
}

// get returns the project detail, enforcing ownership.
func (s *service) get(id, ownerID idgen.ID) (*ProjectDetailVO, error) {
	p, err := s.repo.findByID(id)
	if err != nil {
		return nil, err
	}
	if p.OwnerID != ownerID {
		return nil, errForbidden
	}
	owner, _ := s.repo.findOwner(p.OwnerID)
	d := toProjectDetailVO(p, owner)
	return &d, nil
}

// getByToken resolves a project by its opaque url/share token (public share
// lookup). The token itself is the access capability, so no ownership check is
// applied; the numeric id is never exposed in the URL.
func (s *service) getByToken(tok string) (*ProjectDetailVO, error) {
	tok = strings.TrimSpace(tok)
	if tok == "" {
		return nil, ErrNotFound
	}
	p, err := s.repo.findByToken(tok)
	if err != nil {
		return nil, err
	}
	owner, _ := s.repo.findOwner(p.OwnerID)
	d := toProjectDetailVO(p, owner)
	return &d, nil
}

// update applies partial changes to the owner's project and returns the fresh
// summary VO.
func (s *service) update(id, ownerID idgen.ID, dto UpdateDTO) (*ProjectVO, error) {
	fields := map[string]any{}
	if dto.Name != nil {
		fields["name"] = strings.TrimSpace(*dto.Name)
	}
	if dto.Description != nil {
		fields["description"] = strings.TrimSpace(*dto.Description)
	}
	if dto.Status != nil {
		fields["status"] = *dto.Status
	}
	if dto.IsPublic != nil {
		fields["is_public"] = *dto.IsPublic
	}

	if len(fields) > 0 {
		if err := s.repo.updateFields(id, ownerID, fields); err != nil {
			return nil, err
		}
	}

	p, err := s.repo.findByID(id)
	if err != nil {
		return nil, err
	}
	vo := toProjectVO(p)
	return &vo, nil
}

// remove deletes the owner's project.
func (s *service) remove(id, ownerID idgen.ID) error {
	return s.repo.delete(id, ownerID)
}

// saveCanvas persists canvas data (and optional thumbnail) for the owner's
// project.
func (s *service) saveCanvas(id, ownerID idgen.ID, dto CanvasSaveDTO) error {
	fields := map[string]any{"canvas_data": dto.CanvasData}
	if dto.Thumbnail != "" {
		fields["thumbnail"] = dto.Thumbnail
	}
	return s.repo.updateFields(id, ownerID, fields)
}

// getCanvas returns just the canvas data for the owner's project.
func (s *service) getCanvas(id, ownerID idgen.ID) (*CanvasDataVO, error) {
	p, err := s.repo.findByID(id)
	if err != nil {
		return nil, err
	}
	if p.OwnerID != ownerID {
		return nil, errForbidden
	}
	return &CanvasDataVO{CanvasData: p.CanvasData}, nil
}

// share ensures the project has a share token (generating one on first call),
// marks it public, and returns the share token plus a frontend share URL.
func (s *service) share(id, ownerID idgen.ID) (*ShareVO, error) {
	p, err := s.repo.findByID(id)
	if err != nil {
		return nil, err
	}
	if p.OwnerID != ownerID {
		return nil, errForbidden
	}

	if p.ShareToken == "" {
		p.ShareToken = genToken()
	}
	fields := map[string]any{
		"share_token": p.ShareToken,
		"is_public":   true,
	}
	if err := s.repo.updateFields(id, ownerID, fields); err != nil {
		return nil, err
	}

	return &ShareVO{
		ShareToken: p.ShareToken,
		ShareUrl:   s.buildShareURL(p.ShareToken),
	}, nil
}

// buildShareURL composes the public share link from the frontend origin. The
// canvas editor route is /canvas/{token}; the share token is an alternative
// access token for the same project.
func (s *service) buildShareURL(shareToken string) string {
	base := "http://localhost:3000"
	if s.cfg != nil && len(s.cfg.CORS.AllowOrigins) > 0 {
		if o := strings.TrimSpace(s.cfg.CORS.AllowOrigins[0]); o != "" {
			base = strings.TrimRight(o, "/")
		}
	}
	return base + "/canvas/" + shareToken
}

// genToken returns a 32-hex-char (16-byte) unguessable opaque token. On the
// astronomically unlikely RNG failure it falls back to a snowflake id string.
func genToken() string {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return idgen.Next().String()
	}
	return hex.EncodeToString(b)
}
