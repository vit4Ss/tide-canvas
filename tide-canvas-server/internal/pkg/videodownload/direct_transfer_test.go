package videodownload

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"
)

func TestStalledMediaFallsBackWithoutKeepingPartialFile(t *testing.T) {
	cancelled := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "video/mp4")
		if r.URL.Path == "/stalled.mp4" {
			_, _ = io.WriteString(w, "partial broken file")
			w.(http.Flusher).Flush()
			<-r.Context().Done()
			close(cancelled)
			return
		}
		_, _ = io.WriteString(w, "complete backup")
	}))
	defer server.Close()
	s := testService(t)
	s.mediaIdleTimeout = 100 * time.Millisecond
	base, _ := url.Parse(server.URL)
	s.client.Transport = roundTripFunc(func(r *http.Request) (*http.Response, error) {
		// Keep production URL validation intact; only the test transport dials
		// this local fixture instead of the approved public CDN hostname.
		request := r.Clone(r.Context())
		request.URL.Scheme, request.URL.Host = base.Scheme, base.Host
		return server.Client().Transport.RoundTrip(request)
	})
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	target := filepath.Join(t.TempDir(), "video.mp4")
	err := s.downloadPart(ctx, mediaPart{URLs: []string{
		"https://v.douyinvod.com/stalled.mp4", "https://v.douyinvod.com/backup.mp4",
	}}, "douyin", "https://www.douyin.com/video/12345", target, 1024)
	if err != nil || ctx.Err() != nil {
		t.Fatalf("stalled mirror prevented fallback: %v", err)
	}
	data, _ := os.ReadFile(target)
	if string(data) != "complete backup" {
		t.Fatalf("partial file retained: %q", data)
	}
	select {
	case <-cancelled:
	case <-ctx.Done():
		t.Fatal("stalled upstream connection not cancelled")
	}
}

func TestMediaFailurePreservesHTTPStatusAndCancelStopsMirrors(t *testing.T) {
	for _, status := range []int{403, 404, 429, 502} {
		s := testService(t)
		s.client.Transport = roundTripFunc(func(r *http.Request) (*http.Response, error) {
			resp := responseFor(r, "source error", "text/html")
			resp.StatusCode = status
			return resp, nil
		})
		err := s.downloadPart(context.Background(), mediaPart{URLs: []string{"https://v.douyinvod.com/source.mp4"}}, "douyin", "https://www.douyin.com/video/12345", filepath.Join(t.TempDir(), "video.mp4"), 1024)
		requireError(t, err, 502)
		if !strings.Contains(err.Error(), "HTTP "+strconv.Itoa(status)) {
			t.Fatalf("source status lost: %v", err)
		}
	}
	s := testService(t)
	ctx, cancel := context.WithCancel(context.Background())
	calls := 0
	s.client.Transport = roundTripFunc(func(r *http.Request) (*http.Response, error) {
		calls++
		cancel()
		return nil, ctx.Err()
	})
	err := s.downloadPart(ctx, mediaPart{URLs: []string{"https://v.douyinvod.com/a.mp4", "https://v.douyinvod.com/b.mp4"}}, "douyin", "https://www.douyin.com/video/12345", filepath.Join(t.TempDir(), "video.mp4"), 1024)
	requireError(t, err, 504)
	if calls != 1 {
		t.Fatalf("cancelled download retried: %d requests", calls)
	}
}
