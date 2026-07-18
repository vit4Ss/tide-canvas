// Package response defines the unified HTTP response envelope and helpers
// used by every handler. The shape MUST match the frontend contract
// (tide-canvas-web/src/types/api.ts): camelCase JSON, a top-level success
// flag, a numeric business code, message, data and a millisecond timestamp.
package response

import (
	"math"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"go.uber.org/zap"

	"tidecanvas/internal/pkg/logger"
)

// defaultServerErrorMessage 是 500 统一对外话术的兜底值——后台配置缺失或读取
// 失败（如 DB 本身故障）时使用。
const defaultServerErrorMessage = "请联系客服"

// serverErrorMsgSource, registered at boot (cmd/api), supplies the
// admin-configured 500 话术 (sys_config server.errorMessage). Read per failure
// so 后台改完即生效、无需重启; an empty return falls back to the default.
var serverErrorMsgSource func() string

// SetServerErrorMessageSource registers the runtime source of the unified 500
// user-facing message.
func SetServerErrorMessageSource(f func() string) { serverErrorMsgSource = f }

// Business / HTTP status codes. The lower set mirrors HTTP semantics; the
// higher (1xxx/2xxx/3xxx) are application-specific codes the frontend
// switches on (see ResultCode in types/api.ts).
const (
	CodeOK           = 200
	CodeBadRequest   = 400
	CodeUnauthorized = 401
	CodeForbidden    = 403
	CodeNotFound     = 404
	CodeRateLimited  = 429
	CodeServerError  = 500

	CodeUsernameExists    = 1001
	CodeEmailExists       = 1002
	CodePasswordIncorrect = 1003

	CodeQuotaInsufficient = 2001
	CodeModelUnavailable  = 2002
	CodeHandlerNotFound   = 2003
	CodeContextLimit      = 2004
	CodeToolDisabled      = 2005

	CodeFileTypeNotAllowed  = 3001
	CodeFileSizeExceeded    = 3002
	CodeStorageInsufficient = 3003
)

// Result is the generic response envelope. Every endpoint returns this.
type Result[T any] struct {
	Success   bool   `json:"success"`
	Code      int    `json:"code"`
	Message   string `json:"message"`
	Data      T      `json:"data"`
	Timestamp int64  `json:"timestamp"`
}

// PageData is the standard paginated payload, wrapped inside a Result.
type PageData[T any] struct {
	Records  []T   `json:"records"`
	Total    int64 `json:"total"`
	PageNum  int   `json:"pageNum"`
	PageSize int   `json:"pageSize"`
	Pages    int   `json:"pages"`
}

func now() int64 { return time.Now().UnixMilli() }

// OK writes a successful Result with HTTP 200.
func OK[T any](c *gin.Context, data T) {
	c.JSON(http.StatusOK, Result[T]{
		Success:   true,
		Code:      CodeOK,
		Message:   "success",
		Data:      data,
		Timestamp: now(),
	})
}

// Page wraps records in a PageData and writes a successful Result (HTTP 200).
// pages = ceil(total / pageSize). A non-positive pageSize yields 0 pages.
func Page[T any](c *gin.Context, records []T, total int64, pageNum, pageSize int) {
	pages := 0
	if pageSize > 0 {
		pages = int(math.Ceil(float64(total) / float64(pageSize)))
	}
	if records == nil {
		records = []T{}
	}
	c.JSON(http.StatusOK, Result[PageData[T]]{
		Success: true,
		Code:    CodeOK,
		Message: "success",
		Data: PageData[T]{
			Records:  records,
			Total:    total,
			PageNum:  pageNum,
			PageSize: pageSize,
			Pages:    pages,
		},
		Timestamp: now(),
	})
}

// Fail writes a failure Result. The HTTP status mirrors the code only for the
// standard HTTP codes {400,401,403,404,429,500}; all other (business) codes are
// returned with HTTP 200 so the frontend can read the body uniformly.
//
// CRITICAL: auth failures pass code 401 here, which lands in the JSON body —
// the frontend (http.ts) triggers a token refresh on body code === 401.
func Fail(c *gin.Context, code int, msg string) {
	httpStatus := http.StatusOK
	switch code {
	case CodeBadRequest, CodeUnauthorized, CodeForbidden, CodeNotFound, CodeRateLimited, CodeServerError:
		httpStatus = code
	}
	// 500 类错误对外只回统一话术，不把内部错误细节透给用户（含 panic 恢复和个别
	// 拼了 err.Error() 的调用点）；原始 msg 连同请求路径落服务端日志供排查。
	// 话术取自后台「配置管理」server.errorMessage（保存即生效），读不到用兜底值。
	// 业务码与 4xx 的可读提示不受影响。
	if code == CodeServerError {
		logger.L().Error("server error response",
			zap.String("path", c.FullPath()),
			zap.String("msg", msg),
		)
		msg = defaultServerErrorMessage
		if serverErrorMsgSource != nil {
			if m := strings.TrimSpace(serverErrorMsgSource()); m != "" {
				msg = m
			}
		}
	}
	c.JSON(httpStatus, Result[any]{
		Success:   false,
		Code:      code,
		Message:   msg,
		Data:      nil,
		Timestamp: now(),
	})
}
