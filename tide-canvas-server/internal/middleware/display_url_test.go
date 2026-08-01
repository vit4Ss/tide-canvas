package middleware

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"

	"tidecanvas/internal/pkg/storage"
)

const (
	oldBase = "https://bucket.oss-cn-shanghai.aliyuncs.com"
	newBase = "https://cdn.example.com"
)

// fakeStore 只实现 DisplayURL 关心的方法,其余留空。
type fakeStore struct{ pairs [][2]string }

func (f fakeStore) Save(context.Context, string, io.Reader, string) (string, error) {
	return "", nil
}
func (f fakeStore) Delete(context.Context, string) error { return nil }
func (f fakeStore) URL(key string) string                { return newBase + "/" + key }
func (f fakeStore) Type() string                         { return "oss" }
func (f fakeStore) UpstreamURL(u string) string          { return u }
func (f fakeStore) FetchHosts() []string                 { return nil }
func (f fakeStore) OwnsURL(u string) (string, bool)      { return "", false }
func (f fakeStore) PublicRewrites() [][2]string          { return f.pairs }
func (f fakeStore) Presign(context.Context, string, string) (storage.PresignResult, error) {
	return storage.PresignResult{}, nil
}

func setup(store storage.StorageStrategy, route func(*gin.Context)) *httptest.Server {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(DisplayURL(store))
	r.GET("/x", route)
	return httptest.NewServer(r)
}

func get(t *testing.T, url string) (int, http.Header, string) {
	t.Helper()
	resp, err := http.Get(url)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	b, _ := io.ReadAll(resp.Body)
	return resp.StatusCode, resp.Header, string(b)
}

// JSON 响应里的旧区域域名 → 当前 publicBase;外部 URL 不动。
func TestDisplayURLRewritesJSON(t *testing.T) {
	srv := setup(fakeStore{pairs: [][2]string{{oldBase, newBase}}}, func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{
			"fileUrl":  oldBase + "/canvas/uploads/a.png",
			"nested":   gin.H{"md": "![x](" + oldBase + "/canvas/uploads/b.png?x-oss-process=image/resize,w_100)"},
			"external": "https://relay.example.com/c.png",
		})
	})
	defer srv.Close()

	code, hdr, body := get(t, srv.URL+"/x")
	if code != 200 {
		t.Fatalf("status: %d", code)
	}
	if strings.Contains(body, oldBase) {
		t.Errorf("old base must not survive: %s", body)
	}
	if !strings.Contains(body, newBase+"/canvas/uploads/a.png") {
		t.Errorf("rewritten url missing: %s", body)
	}
	// 带 query 的 URL:前缀替换,query 保留
	if !strings.Contains(body, newBase+"/canvas/uploads/b.png?x-oss-process=image/resize") {
		t.Errorf("query must survive rewrite: %s", body)
	}
	if !strings.Contains(body, "https://relay.example.com/c.png") {
		t.Errorf("external url must stay: %s", body)
	}
	if hdr.Get("Content-Length") != fmt.Sprint(len(body)) {
		t.Errorf("Content-Length %q != actual %d", hdr.Get("Content-Length"), len(body))
	}
}

// 加速域名签名 URL(presign)绝不能被改写——签名会失效。
func TestDisplayURLKeepsSignedAccelerateURL(t *testing.T) {
	signed := "https://bucket.oss-accelerate.aliyuncs.com/canvas/uploads/a.png?OSSAccessKeyId=x&Signature=y"
	srv := setup(fakeStore{pairs: [][2]string{{oldBase, newBase}}}, func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"uploadUrl": signed, "fileUrl": oldBase + "/canvas/uploads/a.png"})
	})
	defer srv.Close()

	_, _, body := get(t, srv.URL+"/x")
	// gin 默认把 & 转义为 &;host+query 参数必须原样保留
	if !strings.Contains(body, "https://bucket.oss-accelerate.aliyuncs.com/canvas/uploads/a.png?OSSAccessKeyId=x\\u0026Signature=y") {
		t.Errorf("signed upload url must survive verbatim: %s", body)
	}
	// 同一响应里的展示 URL 仍然被改写
	if !strings.Contains(body, newBase+"/canvas/uploads/a.png") {
		t.Errorf("display url should be rewritten: %s", body)
	}
}

// SSE 流式响应直通,不做缓冲改写(URL 可能跨 chunk,改写不安全)。
func TestDisplayURLPassthroughSSE(t *testing.T) {
	srv := setup(fakeStore{pairs: [][2]string{{oldBase, newBase}}}, func(c *gin.Context) {
		c.Header("Content-Type", "text/event-stream")
		c.Writer.WriteHeader(200)
		fmt.Fprintf(c.Writer, "data: %s/canvas/uploads/a.png\n\n", oldBase)
		c.Writer.Flush()
	})
	defer srv.Close()

	_, _, body := get(t, srv.URL+"/x")
	if !strings.Contains(body, oldBase) {
		t.Errorf("SSE body must pass through untouched: %s", body)
	}
}

// 非 JSON(下载代理/二进制)直通。
func TestDisplayURLPassthroughBinary(t *testing.T) {
	payload := "binary-bytes-referencing-" + oldBase
	srv := setup(fakeStore{pairs: [][2]string{{oldBase, newBase}}}, func(c *gin.Context) {
		c.Data(http.StatusOK, "application/octet-stream", []byte(payload))
	})
	defer srv.Close()

	_, _, body := get(t, srv.URL+"/x")
	if body != payload {
		t.Errorf("binary body must pass through: %q", body)
	}
}

// 无改写对(本地存储/未配 CDN)时完全直通。
func TestDisplayURLNoopWithoutPairs(t *testing.T) {
	srv := setup(fakeStore{}, func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"fileUrl": oldBase + "/a.png"})
	})
	defer srv.Close()

	_, _, body := get(t, srv.URL+"/x")
	if !strings.Contains(body, oldBase) {
		t.Errorf("no pairs → untouched: %s", body)
	}
}

// 错误状态码(4xx 信封)照样改写且状态保留。
func TestDisplayURLPreservesErrorStatus(t *testing.T) {
	srv := setup(fakeStore{pairs: [][2]string{{oldBase, newBase}}}, func(c *gin.Context) {
		c.JSON(http.StatusNotFound, gin.H{"message": "gone " + oldBase + "/a.png"})
	})
	defer srv.Close()

	code, _, body := get(t, srv.URL+"/x")
	if code != 404 {
		t.Fatalf("status must survive: %d", code)
	}
	if strings.Contains(body, oldBase) {
		t.Errorf("error envelope must be rewritten too: %s", body)
	}
}

// panic 路径:外层 Recovery 补写的 500 信封必须真正发到客户端
// (finish 经由 defer 执行;若 finish 不跑,客户端只会收到 200 空响应)。
func TestDisplayURLPanicRecoveryEnvelope(t *testing.T) {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(DisplayURL(fakeStore{pairs: [][2]string{{oldBase, newBase}}}))
	// 模拟 middleware.Recovery,但写在 DisplayURL 内层:它补写的 JSON 仍经 wrapper
	r.Use(func(c *gin.Context) {
		defer func() {
			if rec := recover(); rec != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"message": "broken " + oldBase + "/a.png"})
				c.Abort()
			}
		}()
		c.Next()
	})
	r.GET("/x", func(c *gin.Context) { panic("boom") })
	srv := httptest.NewServer(r)
	defer srv.Close()

	code, _, body := get(t, srv.URL+"/x")
	if code != 500 {
		t.Fatalf("recovery envelope must reach client as 500, got %d (body %q)", code, body)
	}
	if strings.Contains(body, oldBase) || !strings.Contains(body, newBase+"/a.png") {
		t.Errorf("recovery envelope should be rewritten too: %s", body)
	}
}

// handler 什么都不写:200 空响应,不挂起。
func TestDisplayURLEmptyResponse(t *testing.T) {
	srv := setup(fakeStore{pairs: [][2]string{{oldBase, newBase}}}, func(c *gin.Context) {})
	defer srv.Close()

	code, _, body := get(t, srv.URL+"/x")
	if code != 200 || body != "" {
		t.Errorf("want 200 empty, got %d %q", code, body)
	}
}
