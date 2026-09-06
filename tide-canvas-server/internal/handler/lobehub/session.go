package lobehub

import (
	"errors"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/userkey"
)

// sessionCheck is used by nginx auth_request for LobeHub's protected pages and
// APIs. It rechecks the main account, so disabling a main user also denies an
// already-issued LobeHub session. LobeHub authentication endpoints must bypass
// this subrequest; they are the source used to validate the session cookie.
func (s *service) sessionCheck(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	id, subjects, err := s.lobeIdentity(c.Request.Context(), c.GetHeader("Cookie"))
	if err != nil {
		if errors.Is(err, errLobeLogin) {
			c.Status(401)
		} else {
			c.Status(503)
		}
		return
	}
	var link model.LobeHubLink
	if err := s.d.DB.WithContext(c.Request.Context()).Where("lobe_user_id = ? AND connected_at IS NOT NULL", id).First(&link).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.Status(401)
		} else {
			c.Status(503)
		}
		return
	}
	matched := false
	for _, subject := range subjects {
		if subject == link.UserID.String() {
			matched = true
		}
	}
	if !matched {
		c.Status(403)
		return
	}
	if _, err := s.active(c.Request.Context(), link.UserID); err != nil {
		if errors.Is(err, userkey.ErrAccount) {
			c.Status(403)
		} else {
			c.Status(503)
		}
		return
	}
	c.Status(204)
}
