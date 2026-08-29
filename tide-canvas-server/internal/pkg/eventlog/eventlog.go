// Package eventlog is an asynchronous, fire-and-forget writer for the structured
// audit logs (access / login / business / model-call). Callers enqueue a row and
// return immediately; a background worker persists it. The queue is bounded and
// drops on overflow, so logging can never block or fail a request. It is wired
// once at boot via Init and used through the package-level helpers.
package eventlog

import (
	"encoding/json"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"gorm.io/gorm"

	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/idgen"
	"tidecanvas/internal/pkg/logger"

	"go.uber.org/zap"
)

// queueSize bounds the pending-write buffer; bursts beyond this are dropped
// (logging is best-effort and must never back-pressure request handling).
const queueSize = 4096

// maxBody caps a stored request/response body so a huge payload can't bloat a row.
const maxBody = 16 * 1024

// writer is the singleton async log writer.
type writer struct {
	db *gorm.DB
	ch chan any
}

var defaultWriter *writer

// Init starts the background writer. Safe to call once at boot after the DB is
// open. A nil db disables logging (helpers become no-ops).
func Init(db *gorm.DB) {
	if db == nil {
		return
	}
	w := &writer{db: db, ch: make(chan any, queueSize)}
	defaultWriter = w
	go w.run()
}

// run drains the queue, inserting each row. A failed insert is logged and
// dropped — audit logging never retries into the request path.
func (w *writer) run() {
	for row := range w.ch {
		if err := w.db.Create(row).Error; err != nil {
			logger.L().Warn("eventlog: write failed", zap.Error(err))
		}
	}
}

// enqueue offers a row to the queue without ever blocking; a full queue drops it.
func enqueue(row any) {
	w := defaultWriter
	if w == nil {
		return
	}
	select {
	case w.ch <- row:
	default:
		// Queue saturated — drop to protect latency. Counted at debug level only.
		logger.L().Debug("eventlog: queue full, dropping log row")
	}
}

// Access enqueues an API access log.
func Access(e *model.AccessLog) { enqueue(e) }

// Login enqueues a login/auth log.
func Login(e *model.LoginLog) { enqueue(e) }

// Biz enqueues a business log.
func Biz(e *model.BizLog) { enqueue(e) }

// ModelCall enqueues an upstream model-call log, truncating oversized bodies.
func ModelCall(e *model.ModelCallLog) {
	e.RequestBody = Truncate(e.RequestBody, maxBody)
	e.ResponseBody = Truncate(e.ResponseBody, maxBody)
	enqueue(e)
}

// ModelText is a convenience for the text relay calls (chat / optimize): it
// derives success/status/error from err and enqueues a ModelCallLog. On failure
// the response body is dropped (the error message carries the detail).
// pointCost 是本次调用实扣的平台积分(免费/系统内部调用传 0)。
//
// startedAt 是调用方在发起上游请求前打的本地时间点；耗时由本函数按它现算，
// 保证「开始时间 + 耗时」永远自洽（调用方一律在上游返回后立刻调用本函数）。
type ModelTextBillingRef struct {
	ID   idgen.ID
	Type string
}

func ModelText(userID idgen.ID, scene, modelID, endpoint, requestBody, responseBody string, startedAt time.Time, err error, pointCost int64, billingRef ...ModelTextBillingRef) {
	success, status, errMsg := 1, 200, ""
	if err != nil {
		success, status, errMsg, responseBody = 0, 0, err.Error(), ""
	}
	var billingRefID idgen.ID
	billingRefType := "ledger"
	if len(billingRef) > 0 {
		billingRefID = billingRef[0].ID
		if kind := strings.TrimSpace(billingRef[0].Type); kind != "" {
			billingRefType = kind
		}
	}
	ModelCall(&model.ModelCallLog{
		UserID:         userID,
		Scene:          scene,
		Model:          modelID,
		Endpoint:       endpoint,
		RequestBody:    requestBody,
		ResponseBody:   responseBody,
		HttpStatus:     status,
		Success:        success,
		ErrorMsg:       Truncate(errMsg, 1024),
		StartTime:      startedAt,
		DurationMs:     time.Since(startedAt).Milliseconds(),
		PointCost:      pointCost,
		BillingRefID:   billingRefID,
		BillingRefType: billingRefType,
	})
}

// Truncate clamps s to at most n bytes, appending an ellipsis marker when cut.
// It backs off to a valid UTF-8 boundary so a multibyte rune is never split
// (which would otherwise produce invalid utf8 the DB driver may reject).
func Truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	cut := s[:n]
	for len(cut) > 0 && !utf8.ValidString(cut) {
		cut = cut[:len(cut)-1]
	}
	return cut + "…(truncated)"
}

// SanitizeDataURIs 把序列化请求体里的 base64 data URI 载荷替换成体积占位
// （保留 data: 前缀与原始字节数）。文档附件的 file_data 动辄几十 MB,不净化
// 的话 ModelCall 的 16KB 截断会把后续所有字段（含其它附件的文件名）连同
// JSON 结构一起切掉,生成记录详情将无法展示「用户传了什么」。非 JSON 或
// 无 data URI 时原样返回。
func SanitizeDataURIs(body string) string {
	if !strings.Contains(body, "data:") && !strings.Contains(body, `"input_audio"`) {
		return body
	}
	var v any
	if err := json.Unmarshal([]byte(body), &v); err != nil {
		return body
	}
	scrubDataURIs(v)
	out, err := json.Marshal(v)
	if err != nil {
		return body
	}
	return string(out)
}

// scrubDataURIs 深度遍历解码后的 JSON,就地替换超长 data: 字符串。
func scrubDataURIs(v any) {
	switch t := v.(type) {
	case map[string]any:
		if data, ok := t["data"].(string); ok && len(data) > 256 {
			format, _ := t["format"].(string)
			if format = strings.ToLower(strings.TrimSpace(format)); format == "mp3" || format == "wav" {
				t["data"] = "…(base64 omitted, " + strconv.Itoa(len(data)) + " bytes)"
			}
		}
		for k, val := range t {
			if s, ok := val.(string); ok && strings.HasPrefix(s, "data:") && len(s) > 256 {
				t[k] = "data:…(base64 omitted, " + strconv.Itoa(len(s)) + " bytes)"
				continue
			}
			scrubDataURIs(val)
		}
	case []any:
		for _, val := range t {
			scrubDataURIs(val)
		}
	}
}
