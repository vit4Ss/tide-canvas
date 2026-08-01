// display_url.go rewrites persisted storage URLs in outbound JSON responses to
// the current public base (see StorageStrategy.PublicRewrites). Asset URLs are
// stamped into the DB at upload time; when the public base changes (e.g. a CDN
// domain is introduced), historical rows still carry the old host. Touching
// every VO in every domain to recompute URLs is fragile — instead this
// middleware normalizes at the response boundary, in one place, covering
// single-URL fields, URL arrays and URL-bearing blobs (canvas_data, blog
// markdown, chat attachment JSON) alike.
//
// Only JSON responses are buffered and rewritten. Streaming responses (SSE,
// the download proxy, static files) pass through untouched — chunked/streamed
// bodies cannot be safely string-replaced (a URL may span a chunk boundary).
// Signed presign URLs survive because the presign route is exempted wholesale
// (it is the only place SignURL is used, see storage.OSSStorage.Presign).
package middleware

import (
	"bytes"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"

	"tidecanvas/internal/pkg/storage"
)

// DisplayURL rewrites old-base asset URLs in JSON responses to the current
// public base. No-op passthrough when the storage backend has nothing to
// rewrite (local storage, or OSS without a CDN domain).
//
// presign 路由整体豁免:直传签名 URL 在加速域名上,改写 host 会让签名失效。
// 这也是唯一会产生签名 URL 的地方(SignURL 仅在 Presign 使用)。
func DisplayURL(store storage.StorageStrategy) gin.HandlerFunc {
	var pairs [][2][]byte
	if store != nil {
		for _, p := range store.PublicRewrites() {
			if p[0] != "" && p[1] != "" && p[0] != p[1] {
				pairs = append(pairs, [2][]byte{[]byte(p[0]), []byte(p[1])})
			}
		}
	}
	if len(pairs) == 0 {
		return func(c *gin.Context) { c.Next() }
	}
	return func(c *gin.Context) {
		if isPresignPath(c.Request.URL.Path) {
			c.Next()
			return
		}
		w := &displayURLWriter{ResponseWriter: c.Writer, pairs: pairs}
		c.Writer = w
		// defer 而非 c.Next() 之后同步调用:handler panic 时 c.Next() 不返回,
		// 但 finish 必须跑——且跑完后 writer 进入终态直通,外层 Recovery 补写
		// 的 500 信封才能正常发出去。
		defer w.finish()
		c.Next()
	}
}

// isPresignPath 直传签名接口(/api/files/presign 及批量):响应里的 uploadUrl
// 是加速域名签名 URL,绝不能参与改写。
func isPresignPath(p string) bool {
	return strings.HasPrefix(p, "/api/files/presign")
}

// displayURLWriter buffers JSON response bodies for end-of-request rewriting;
// anything else streams through unmodified.
//
// 判定时机必须推迟到第一个 Write:gin 的顺序是 c.Status → WriteHeader(此时
// Content-Type 还没设)→ render 设 Content-Type → Write body。在 WriteHeader
// 里判定会误判成直通。
type displayURLWriter struct {
	gin.ResponseWriter
	pairs  [][2][]byte
	status int    // handler 设置的状态码(首个 WriteHeader 记录)
	decide bool   // 已在第一个 Write 时判定
	buffer bool   // 判定结果:缓冲 or 直通
	buf    []byte // 缓冲的响应体(buffer 模式)
	sent   bool   // 状态行已转发给底层 writer
	done   bool   // finish 已执行;此后一切写入直通(panic 后 Recovery 补写场景)
}

// shouldBuffer reports whether this response is rewrite-eligible JSON.
func (w *displayURLWriter) shouldBuffer() bool {
	ct := w.Header().Get("Content-Type")
	return strings.HasPrefix(ct, "application/json")
}

// WriteHeader records the status code; nothing goes on the wire until the
// first Write decides buffer-vs-stream (or finish/WriteHeaderNow forces it).
func (w *displayURLWriter) WriteHeader(code int) {
	if w.status == 0 {
		w.status = code
	}
}

// forwardHeader pushes the recorded status to the underlying writer.
func (w *displayURLWriter) forwardHeader() {
	if w.sent {
		return
	}
	w.sent = true
	status := w.status
	if status == 0 {
		status = 200
	}
	w.ResponseWriter.WriteHeader(status)
}

func (w *displayURLWriter) Write(b []byte) (int, error) {
	if w.done {
		// finish 之后的补写(panic 恢复路径):直接透传。
		w.forwardHeader()
		return w.ResponseWriter.Write(b)
	}
	if !w.decide {
		w.decide = true
		w.buffer = w.shouldBuffer()
		if !w.buffer {
			w.forwardHeader()
		}
	}
	if w.buffer {
		w.buf = append(w.buf, b...)
		return len(b), nil
	}
	return w.ResponseWriter.Write(b)
}

// WriteString 统一走 Write,保证判定逻辑不被绕过。
func (w *displayURLWriter) WriteString(s string) (int, error) {
	return w.Write([]byte(s))
}

// finish flushes a buffered JSON body with all rewrite pairs applied. It runs
// via defer so it also fires on the panic path; afterwards the writer is in a
// terminal passthrough state so an outer Recovery middleware can still emit
// its error envelope.
func (w *displayURLWriter) finish() {
	if w.done {
		return
	}
	w.done = true
	if !w.decide {
		// handler 没写过 body:显式设过状态码(如 204)就转发,否则不动底层——
		// 正常路径 net/http 默认 200 空响应;panic 路径留给 Recovery 完整控制。
		if w.status != 0 {
			w.forwardHeader()
		}
		return
	}
	if !w.buffer {
		return
	}
	body := w.buf
	for _, p := range w.pairs {
		body = bytes.ReplaceAll(body, p[0], p[1])
	}
	w.buf = nil
	w.buffer = false
	w.Header().Set("Content-Length", strconv.Itoa(len(body)))
	w.forwardHeader()
	_, _ = w.ResponseWriter.Write(body)
}

// WriteHeaderNow forces the response out when gin's internals demand headers
// on the wire immediately (e.g. AbortWithStatus 无 body 场景)。
func (w *displayURLWriter) WriteHeaderNow() {
	if w.done || !w.decide {
		w.decide = true
		w.forwardHeader()
		return
	}
	if w.buffer {
		w.finish()
		return
	}
	w.ResponseWriter.WriteHeaderNow()
}

// Flush streams whatever is buffered (rewritten) and switches to passthrough
// for the rest of the request, so flush-driven handlers never stall.
func (w *displayURLWriter) Flush() {
	if w.done {
		w.ResponseWriter.Flush()
		return
	}
	if !w.decide {
		w.decide = true
		w.forwardHeader()
	} else if w.buffer {
		w.finish()
	}
	w.ResponseWriter.Flush()
}

// Status reports the handler-set status even while it is still buffered
// (ZapLogger / AccessLog / Recovery read this after c.Next()).
func (w *displayURLWriter) Status() int {
	if w.status != 0 {
		return w.status
	}
	return w.ResponseWriter.Status()
}

// Written reports whether the handler produced anything (buffered or sent).
func (w *displayURLWriter) Written() bool {
	return w.status != 0 || len(w.buf) > 0 || w.ResponseWriter.Written()
}

// Size accounts for the buffered body before it is flushed.
func (w *displayURLWriter) Size() int {
	if w.decide && w.buffer {
		return len(w.buf)
	}
	return w.ResponseWriter.Size()
}
