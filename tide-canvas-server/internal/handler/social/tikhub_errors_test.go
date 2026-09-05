package social

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestTikHubGetReadsStructuredFailureDetails(t *testing.T) {
	for _, tt := range []struct {
		name   string
		status int
		body   string
		want   string
	}{
		{"nested detail", 400, `{"detail":{"request_id":"request-400","message":"upstream failed","message_zh":"未取得视频数据，请使用 V2 接口"}}`, "未取得视频数据"},
		{"error object", 400, `{"error":{"message":"video data unavailable"}}`, "video data unavailable"},
		{"validation", 422, `{"detail":[{"loc":["query","aweme_id"],"msg":"Field required","input":"do-not-echo"}]}`, "aweme_id: Field required"},
		{"generic envelope", 400, `{"message":"Bad Request","detail":{"message_zh":"视频解析暂不可用"}}`, "视频解析暂不可用"},
		{"business error", 200, `{"code":400,"message":"Request successful","detail":{"message_zh":"未取得视频数据"}}`, "未取得视频数据"},
		{"generic detail", 200, `{"code":400,"detail":"Request successful"}`, "TikHub 请求未成功"},
		{"credential echo", 400, `{"detail":"invalid credential test-provider-secret"}`, "[redacted]"},
	} {
		t.Run(tt.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.WriteHeader(tt.status)
				fmt.Fprint(w, tt.body)
			}))
			defer server.Close()
			h := &handler{httpcli: server.Client()}
			_, err := h.tikhubGet(context.Background(), settings{baseURL: server.URL, apiKey: "test-provider-secret"}, "/api/v1/test", nil)
			if err == nil || !strings.Contains(err.Error(), tt.want) || strings.Contains(err.Error(), "test-provider-secret") || strings.Contains(err.Error(), "do-not-echo") {
				t.Fatalf("error=%v, want %q without sensitive fields", err, tt.want)
			}
		})
	}
}

func TestTikHubGetPreservesHTTPStatusAndRequestID(t *testing.T) {
	for _, tc := range []struct {
		body   string
		wantID string
	}{
		{`{"detail":{"request_id":"body-request","message_zh":"未取得视频数据"}}`, "body-request"},
		{`{"request_id":"outer-request","detail":"未取得视频数据"}`, "outer-request"},
		{`{"detail":"未取得视频数据"}`, "header-request"},
	} {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("X-Request-ID", "header-request")
			w.WriteHeader(http.StatusBadRequest)
			fmt.Fprint(w, tc.body)
		}))
		h := &handler{httpcli: server.Client()}
		_, err := h.tikhubGet(context.Background(), settings{baseURL: server.URL, apiKey: "test-key"}, "/api/v1/test", nil)
		server.Close()
		var upstream *upstreamError
		if !errors.As(err, &upstream) || upstream.httpStatus != 400 || upstream.status != 400 || upstream.requestID != tc.wantID {
			t.Fatalf("missing diagnostics: %+v", upstream)
		}
	}
}

func TestTikHubDouyinDownloadUsesV2AndRetainsLegacyFallback(t *testing.T) {
	const source = "https://www.douyin.com/jingxuan?modal_id=7665717903026588928"
	paths := []string{
		"/api/v1/douyin/app/v3/fetch_one_video_v2",
		"/api/v1/douyin/web/fetch_one_video_v2",
		"/api/v1/douyin/app/v3/fetch_one_video",
		"/api/v1/douyin/web/fetch_one_video",
	}
	for successIndex, successPath := range paths {
		t.Run(successPath, func(t *testing.T) {
			var calls []string
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				calls = append(calls, r.URL.Path)
				if r.URL.Query().Get("aweme_id") != "7665717903026588928" {
					t.Error("modal ID was lost or rounded")
				}
				if r.URL.Path != successPath {
					w.WriteHeader(400)
					fmt.Fprint(w, `{"detail":{"message_zh":"此接口未取得视频数据"}}`)
					return
				}
				fmt.Fprint(w, `{"code":200,"data":{"aweme_detail":{"aweme_id":"7665717903026588928","video":{"play_addr":{"width":1280,"height":720,"url_list":["https://v.douyinvod.com/result.mp4"]}}}}}`)
			}))
			defer server.Close()
			h := &handler{httpcli: server.Client()}
			video, err := h.fetchDouyinDownload(context.Background(), settings{baseURL: server.URL, apiKey: "test-key"}, source, "compat")
			if err != nil || video == nil || len(calls) != successIndex+1 || strings.Join(calls, ",") != strings.Join(paths[:successIndex+1], ",") {
				t.Fatalf("video=%+v err=%v calls=%v", video, err, calls)
			}
		})
	}
}
