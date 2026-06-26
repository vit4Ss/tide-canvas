// Package eventlog is an asynchronous, fire-and-forget writer for the structured
// audit logs (access / login / business / model-call). Callers enqueue a row and
// return immediately; a background worker persists it. The queue is bounded and
// drops on overflow, so logging can never block or fail a request. It is wired
// once at boot via Init and used through the package-level helpers.
package eventlog

import (
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
func ModelText(userID idgen.ID, scene, modelID, endpoint, requestBody, responseBody string, durationMs int64, err error) {
	success, status, errMsg := 1, 200, ""
	if err != nil {
		success, status, errMsg, responseBody = 0, 0, err.Error(), ""
	}
	ModelCall(&model.ModelCallLog{
		UserID:       userID,
		Scene:        scene,
		Model:        modelID,
		Endpoint:     endpoint,
		RequestBody:  requestBody,
		ResponseBody: responseBody,
		HttpStatus:   status,
		Success:      success,
		ErrorMsg:     Truncate(errMsg, 1024),
		DurationMs:   durationMs,
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
