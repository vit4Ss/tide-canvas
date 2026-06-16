// Package response 统一 HTTP 响应体，对齐旧后端 com.tidecanvas.common.Result / PageResult。
package response

import (
	"errors"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/tidecanvas/tide-canvas-go/pkg/ecode"
)

// Result 统一响应体。
type Result struct {
	Success   bool        `json:"success"`
	Code      int         `json:"code"`
	Message   string      `json:"message"`
	Data      interface{} `json:"data,omitempty"`
	Timestamp int64       `json:"timestamp"`
}

// PageResult 分页数据，对齐旧后端 PageResult。
type PageResult struct {
	Records  interface{} `json:"records"`
	Total    int64       `json:"total"`
	PageNum  int         `json:"pageNum"`
	PageSize int         `json:"pageSize"`
	Pages    int64       `json:"pages"`
}

func nowMillis() int64 { return time.Now().UnixMilli() }

// OK 成功响应（HTTP 200）。
func OK(c *gin.Context, data interface{}) {
	c.JSON(http.StatusOK, Result{
		Success:   true,
		Code:      ecode.Success.Code(),
		Message:   ecode.Success.Message(),
		Data:      data,
		Timestamp: nowMillis(),
	})
}

// Fail 业务失败响应（HTTP 200，业务码在 body，对齐旧后端 BusinessException 处理）。
func Fail(c *gin.Context, e *ecode.Error) {
	c.JSON(http.StatusOK, Result{
		Success:   false,
		Code:      e.Code(),
		Message:   e.Message(),
		Timestamp: nowMillis(),
	})
}

// FailWith 自定义文案的业务失败响应。
func FailWith(c *gin.Context, e *ecode.Error, message string) {
	c.JSON(http.StatusOK, Result{
		Success:   false,
		Code:      e.Code(),
		Message:   message,
		Timestamp: nowMillis(),
	})
}

// FailErr 将 error 映射为统一失败响应：*ecode.Error 用其码/文案，其余按系统错误(500)。
// 供各模块 handler 统一收口 service 返回的错误。
func FailErr(c *gin.Context, err error) {
	var e *ecode.Error
	if errors.As(err, &e) {
		Fail(c, e)
		return
	}
	Fail(c, ecode.ServerError)
}

// Page 构造分页结果（与 OK 搭配：response.OK(c, response.Page(...))）。
func Page(records interface{}, total int64, pageNum, pageSize int) PageResult {
	var pages int64
	if pageSize > 0 {
		pages = (total + int64(pageSize) - 1) / int64(pageSize)
	}
	return PageResult{Records: records, Total: total, PageNum: pageNum, PageSize: pageSize, Pages: pages}
}
