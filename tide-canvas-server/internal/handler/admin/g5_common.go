// Package admin holds the admin-console handlers. The route group passed to each
// Register* func is already mounted with JWTAuth + AdminOnly by the assemble
// step, so handlers here may assume the caller is an admin (role 9).
//
// LINKAGE: admin sections that have a user-facing counterpart read/write the SAME
// table the user pages use, so admin edits are immediately visible on the
// front-end. Group g5 (marketing/resources/logs/config/email) operates on the
// admin-only tables created by the models step (campaign, coupon, admin_resource,
// sys_log, sys_config, email_template, api_key); these have no public-facing
// counterpart yet, so the linkage rule is satisfied trivially (one table each).
package admin

import (
	"encoding/json"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"

	"tidecanvas/internal/pkg/idgen"
	"tidecanvas/internal/pkg/response"
)

// jsonUnmarshal is a thin alias over encoding/json used by handlers that need to
// accept multiple request body shapes (see config upsert).
func jsonUnmarshal(data []byte, v any) error { return json.Unmarshal(data, v) }

// g5PageQuery is the shared pagination + filter binding for g5 list endpoints.
// All query params are camelCase to match the frontend wire contract.
type g5PageQuery struct {
	PageNum  int    `form:"pageNum"`
	PageSize int    `form:"pageSize"`
	Keyword  string `form:"keyword"`
	// Optional filters used by specific lists (logs: level/module).
	Level  string `form:"level"`
	Module string `form:"module"`
	Status string `form:"status"`
	Type   string `form:"type"`
	Scene  string `form:"scene"`
	// Audit-log filters.
	Action  string `form:"action"`
	UserID  string `form:"userId"`
	Success string `form:"success"`
}

// normalize applies pagination defaults/clamps and trims discrete filters.
func (q *g5PageQuery) normalize() {
	if q.PageNum <= 0 {
		q.PageNum = 1
	}
	if q.PageSize <= 0 {
		q.PageSize = 20
	}
	if q.PageSize > 100 {
		q.PageSize = 100
	}
	q.Keyword = strings.TrimSpace(q.Keyword)
	q.Level = strings.TrimSpace(q.Level)
	q.Module = strings.TrimSpace(q.Module)
	q.Status = strings.TrimSpace(q.Status)
	q.Type = strings.TrimSpace(q.Type)
	q.Scene = strings.TrimSpace(q.Scene)
	q.Action = strings.TrimSpace(q.Action)
	q.UserID = strings.TrimSpace(q.UserID)
	q.Success = strings.TrimSpace(q.Success)
}

// offset returns the SQL offset for the current page.
func (q *g5PageQuery) offset() int { return (q.PageNum - 1) * q.PageSize }

// g5ParseID extracts and validates the :id path param, writing a 400 on failure.
func g5ParseID(c *gin.Context) (idgen.ID, bool) {
	id, err := idgen.Parse(c.Param("id"))
	if err != nil || id == 0 {
		response.Fail(c, response.CodeBadRequest, "invalid id")
		return 0, false
	}
	return id, true
}

// g5RandToken returns a short opaque token derived from a fresh snowflake id,
// used to mint API key values when the client does not supply one.
func g5RandToken() string {
	return "sk-" + strconv.FormatInt(idgen.Next().Int64(), 36) + strconv.FormatInt(idgen.Next().Int64(), 36)
}
