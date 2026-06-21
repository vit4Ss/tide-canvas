// Package response defines the unified HTTP response envelope and helpers
// used by every handler. The shape MUST match the frontend contract
// (tide-canvas-web/src/types/api.ts): camelCase JSON, a top-level success
// flag, a numeric business code, message, data and a millisecond timestamp.
package response

import (
	"math"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
)

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
	c.JSON(httpStatus, Result[any]{
		Success:   false,
		Code:      code,
		Message:   msg,
		Data:      nil,
		Timestamp: now(),
	})
}
