package videodownload

import (
	"context"
	"io"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"
)

// Preview streams an already resolved, signed media source. It never calls the
// provider, starts ffmpeg, creates download history, or buffers the whole file.
func (s *Service) Preview(ctx context.Context, platform, raw, byteRange string) (*http.Response, error) {
	if s == nil || !s.cfg.Enabled {
		return nil, failure(503, "视频预览服务未启用")
	}
	raw = trustedMedia(raw, platform)
	if raw == "" {
		return nil, failure(400, "无效的视频预览地址")
	}
	if !validPreviewRange(byteRange) {
		return nil, failure(416, "无效的视频播放范围")
	}
	select {
	case s.previews <- struct{}{}:
	default:
		return nil, failure(429, "视频预览繁忙，请稍后重试")
	}
	ctx, cancel := context.WithTimeout(ctx, 5*time.Minute)
	release := sync.OnceFunc(func() { cancel(); <-s.previews })
	keep := false
	defer func() {
		if !keep {
			release()
		}
	}()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, raw, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", userAgent)
	// Use the platform origin, never the browser's ticket-bearing URL or its
	// cookies. Media hosts may enforce the same Referer check as downloads.
	if domains := roots[platform]; len(domains) > 0 {
		req.Header.Set("Referer", "https://www."+domains[0]+"/")
	}
	if byteRange != "" {
		req.Header.Set("Range", byteRange)
	}
	resp, err := s.client.Do(req)
	if err != nil {
		return nil, failure(502, "视频预览暂时不可用")
	}
	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusPartialContent {
		resp.Body.Close()
		status := 502
		if resp.StatusCode == 416 {
			status = 416
		}
		return nil, failure(status, "视频预览地址已失效或暂时不可用，请重新获取")
	}
	ct := strings.ToLower(strings.TrimSpace(strings.Split(resp.Header.Get("Content-Type"), ";")[0]))
	if !strings.HasPrefix(ct, "video/") && ct != "application/octet-stream" {
		resp.Body.Close()
		return nil, failure(502, "平台返回的预览内容不是视频")
	}
	total := resp.ContentLength
	if value := resp.Header.Get("Content-Range"); value != "" {
		if _, tail, ok := strings.Cut(value, "/"); ok {
			if size, err := strconv.ParseInt(tail, 10, 64); err == nil {
				total = max(total, size)
			}
		}
	}
	if total > s.cfg.MaxFileBytes {
		resp.Body.Close()
		return nil, failure(413, "视频超过当前预览大小上限")
	}
	resp.Body = &previewBody{Reader: io.LimitReader(resp.Body, s.cfg.MaxFileBytes), body: resp.Body, release: release}
	keep = true
	return resp, nil
}

type previewBody struct {
	io.Reader
	body    io.Closer
	release func()
}

func (b *previewBody) Close() error { err := b.body.Close(); b.release(); return err }

func validPreviewRange(value string) bool {
	if value == "" {
		return true
	}
	if !strings.HasPrefix(value, "bytes=") || len(value) > 64 {
		return false
	}
	start, end, ok := strings.Cut(strings.TrimPrefix(value, "bytes="), "-")
	if !ok || start == "" && end == "" {
		return false
	}
	parse := func(s string) (int64, bool) {
		for _, c := range s {
			if c < '0' || c > '9' {
				return 0, false
			}
		}
		n, err := strconv.ParseInt(s, 10, 64)
		return n, err == nil && n >= 0
	}
	if start == "" {
		n, ok := parse(end)
		return ok && n > 0
	}
	a, ok := parse(start)
	if !ok {
		return false
	}
	if end == "" {
		return true
	}
	b, ok := parse(end)
	return ok && b >= a
}
