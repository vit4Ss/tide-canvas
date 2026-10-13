package ai

import (
	"github.com/gin-gonic/gin"
	"net/http"
	"strings"
	"tidecanvas/internal/middleware"
	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/idgen"
	"tidecanvas/internal/pkg/response"
	"unicode"
)

func (h *handler) renameTask(c *gin.Context) {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 4096)
	var dto struct {
		Name string `json:"name" binding:"required,max=160"`
	}
	id, err := idgen.Parse(c.Param("id"))
	if err != nil || id == 0 || c.ShouldBindJSON(&dto) != nil || strings.TrimSpace(dto.Name) == "" || strings.ContainsFunc(dto.Name, unicode.IsControl) {
		response.Fail(c, response.CodeBadRequest, "Enter a name of 1 to 160 characters.")
		return
	}
	q := h.svc.repo.db.WithContext(c.Request.Context()).Model(&model.AiTask{}).Where("id = ? AND user_id = ? AND status = ?", id, middleware.CurrentUserID(c), statusSuccess)
	var count int64
	if err := q.Count(&count).Error; err != nil {
		response.Fail(c, response.CodeServerError, "Unable to rename this creation.")
		return
	}
	if count == 0 {
		response.Fail(c, response.CodeNotFound, "Completed creation not found.")
		return
	}
	if err := h.svc.repo.db.WithContext(c.Request.Context()).Model(&model.AiTask{}).Where("id = ? AND user_id = ? AND status = ?", id, middleware.CurrentUserID(c), statusSuccess).Update("display_name", strings.TrimSpace(dto.Name)).Error; err != nil {
		response.Fail(c, response.CodeServerError, "Unable to rename this creation.")
		return
	}
	response.OK[any](c, nil)
}
