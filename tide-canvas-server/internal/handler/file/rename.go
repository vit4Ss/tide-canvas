package file

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

func (h *handler) rename(c *gin.Context) {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 4096)
	var dto struct {
		Name string `json:"name" binding:"required,max=160"`
	}
	id, err := idgen.Parse(c.Param("id"))
	if err != nil || id == 0 || c.ShouldBindJSON(&dto) != nil || strings.TrimSpace(dto.Name) == "" || strings.ContainsAny(dto.Name, "/\\") || strings.ContainsFunc(dto.Name, unicode.IsControl) {
		response.Fail(c, response.CodeBadRequest, "Enter a file name of 1 to 160 characters without path separators.")
		return
	}
	q := h.svc.repo.db.WithContext(c.Request.Context()).Model(&model.File{}).Where("id = ? AND owner_id = ?", id, middleware.CurrentUserID(c))
	var count int64
	if err := q.Count(&count).Error; err != nil {
		response.Fail(c, response.CodeServerError, "Unable to rename this file.")
		return
	}
	if count == 0 {
		response.Fail(c, response.CodeNotFound, "File not found.")
		return
	}
	if err := h.svc.repo.db.WithContext(c.Request.Context()).Model(&model.File{}).Where("id = ? AND owner_id = ?", id, middleware.CurrentUserID(c)).Update("original_name", strings.TrimSpace(dto.Name)).Error; err != nil {
		response.Fail(c, response.CodeServerError, "Unable to rename this file.")
		return
	}
	response.OK[any](c, nil)
}
