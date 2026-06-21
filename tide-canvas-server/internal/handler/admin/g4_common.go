package admin

import (
	"time"

	"github.com/gin-gonic/gin"

	"tidecanvas/internal/pkg/idgen"
	"tidecanvas/internal/pkg/response"
)

// g4_common.go holds small helpers shared by the g4 (pricing/payments/points)
// admin handlers. All identifiers are g4-prefixed to avoid collisions with the
// other admin handler groups that share this package.

// g4ParseID extracts and validates the :id path param, writing a 400 on failure.
func g4ParseID(c *gin.Context) (idgen.ID, bool) {
	id, err := idgen.Parse(c.Param("id"))
	if err != nil || id == 0 {
		response.Fail(c, response.CodeBadRequest, "invalid id")
		return 0, false
	}
	return id, true
}

// g4FormatTime renders a time as RFC3339, or "" for the zero value.
func g4FormatTime(t time.Time) string {
	if t.IsZero() {
		return ""
	}
	return t.Format(time.RFC3339)
}

// g4Page holds the normalized pagination params parsed from the query string.
type g4Page struct {
	PageNum  int `form:"pageNum"`
	PageSize int `form:"pageSize"`
}

// normalize clamps page params to sane defaults (pageNum>=1, 1<=pageSize<=100).
func (q *g4Page) normalize() {
	if q.PageNum < 1 {
		q.PageNum = 1
	}
	if q.PageSize < 1 {
		q.PageSize = 20
	}
	if q.PageSize > 100 {
		q.PageSize = 100
	}
}

// offset returns the SQL offset for the current page.
func (q *g4Page) offset() int { return (q.PageNum - 1) * q.PageSize }
