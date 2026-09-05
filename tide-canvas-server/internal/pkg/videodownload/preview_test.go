package videodownload

import (
	"context"
	"errors"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"

	"tidecanvas/internal/config"
)

func TestPreviewRangesAndCleanup(t *testing.T) {
	s := New(config.VideoDownloaderConfig{Enabled: true, MaxConcurrentResolves: 1, MaxFileBytes: 1000})
	requests := 0
	s.client.Transport = roundTripFunc(func(r *http.Request) (*http.Response, error) {
		requests++
		if r.Header.Get("Range") != "bytes=10-19" || r.Header.Get("Referer") != "https://www.douyin.com/" || r.Header.Get("Authorization") != "" || r.Header.Get("Cookie") != "" {
			t.Fatalf("unexpected headers: %v", r.Header)
		}
		response := responseFor(r, "0123456789", "video/mp4")
		response.StatusCode = 206
		response.Header.Set("Content-Range", "bytes 10-19/100")
		return response, nil
	})
	resp, err := s.Preview(context.Background(), "douyin", "https://v.douyinvod.com/result.mp4", "bytes=10-19")
	if err != nil || resp.StatusCode != 206 {
		t.Fatalf("preview=%v err=%v", resp, err)
	}
	body, _ := io.ReadAll(resp.Body)
	if string(body) != "0123456789" {
		t.Fatal("range changed")
	}
	if _, err := s.Preview(context.Background(), "douyin", "https://v.douyinvod.com/result.mp4", "bytes=10-19"); err == nil {
		t.Fatal("unbounded preview concurrency")
	}
	resp.Body.Close()
	resp.Body.Close()
	resp, err = s.Preview(context.Background(), "douyin", "https://v.douyinvod.com/result.mp4", "bytes=10-19")
	if err != nil {
		t.Fatal("preview slot leaked", err)
	}
	resp.Body.Close()
	if requests != 2 {
		t.Fatalf("requests=%d", requests)
	}
}

func TestPreviewCancellationReleasesUpstream(t *testing.T) {
	s := New(config.VideoDownloaderConfig{Enabled: true, MaxConcurrentResolves: 1})
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	upstreamDone := make(chan struct{})
	s.client.Transport = roundTripFunc(func(r *http.Request) (*http.Response, error) {
		reader, writer := io.Pipe()
		go func() {
			<-r.Context().Done()
			_ = writer.CloseWithError(r.Context().Err())
			close(upstreamDone)
		}()
		resp := responseFor(r, "", "video/mp4")
		resp.ContentLength = -1
		resp.Body = reader
		return resp, nil
	})
	resp, err := s.Preview(ctx, "douyin", "https://v.douyinvod.com/a.mp4", "")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	cancel() // The browser closed the player while a read was pending.
	select {
	case <-upstreamDone:
	case <-time.After(2 * time.Second):
		t.Fatal("upstream request survived cancellation")
	}
	if _, err := io.ReadAll(resp.Body); !errors.Is(err, context.Canceled) {
		t.Fatalf("cancelled preview read: %v", err)
	}
	resp.Body.Close() // As in the handler after io.Copy returns.
	if len(s.previews) != 0 {
		t.Fatal("cancelled preview leaked concurrency slot")
	}
}

func TestPreviewRejectsUnsafeRequestsAndInvalidResponses(t *testing.T) {
	s := New(config.VideoDownloaderConfig{Enabled: true, MaxConcurrentResolves: 1, MaxFileBytes: 100})
	for _, raw := range []string{"https://127.0.0.1/a.mp4", "https://example.com/a.mp4", "https://v.douyinvod.com:8443/a.mp4"} {
		if _, err := s.Preview(context.Background(), "douyin", raw, ""); err == nil {
			t.Fatal("unsafe preview allowed")
		}
	}
	for _, value := range []string{"bytes=-", "bytes=-0", "bytes=10-1", "bytes=1-2,4-5", "bytes=+1-2", "bytes=99999999999999999999999-"} {
		if validPreviewRange(value) {
			t.Fatalf("invalid range allowed: %s", value)
		}
	}
	for _, value := range []string{"", "bytes=0-", "bytes=-512", "bytes=10-20"} {
		if !validPreviewRange(value) {
			t.Fatalf("valid range rejected: %s", value)
		}
	}
	for _, kind := range []string{"html", "oversize", "partial-oversize", "expired"} {
		s.client.Transport = roundTripFunc(func(r *http.Request) (*http.Response, error) {
			resp := responseFor(r, strings.Repeat("x", 10), "video/mp4")
			switch kind {
			case "html":
				resp.Header.Set("Content-Type", "text/html")
			case "oversize":
				resp.ContentLength = 200
			case "partial-oversize":
				resp.StatusCode = 206
				resp.Header.Set("Content-Range", "bytes 0-9/200")
			case "expired":
				resp.StatusCode = 403
			}
			return resp, nil
		})
		if _, err := s.Preview(context.Background(), "douyin", "https://v.douyinvod.com/a.mp4", ""); err == nil {
			t.Fatalf("invalid %s response accepted", kind)
		}
		if len(s.previews) != 0 {
			t.Fatal("error leaked preview slot")
		}
	}
}
