package alerting

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"testing"
)

type roundTripFunc func(*http.Request) (*http.Response, error)

func (fn roundTripFunc) RoundTrip(req *http.Request) (*http.Response, error) {
	return fn(req)
}

func TestSendWeComTextMessage(t *testing.T) {
	t.Helper()
	var received map[string]any
	svc := &Service{client: &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		if req.Method != http.MethodPost {
			t.Fatalf("method = %s, want POST", req.Method)
		}
		if req.URL.Host != "qyapi.weixin.qq.com" || req.URL.Path != "/cgi-bin/webhook/send" || req.URL.Query().Get("key") != "test-key" {
			t.Fatalf("unexpected webhook target: %s", req.URL.String())
		}
		if req.Header.Get("Content-Type") != "application/json" {
			t.Fatalf("content type = %q", req.Header.Get("Content-Type"))
		}
		if err := json.NewDecoder(req.Body).Decode(&received); err != nil {
			t.Fatal(err)
		}
		return &http.Response{
			StatusCode: http.StatusOK,
			Body:       io.NopCloser(strings.NewReader(`{"errcode":0,"errmsg":"ok"}`)),
			Header:     make(http.Header),
		}, nil
	})}}

	result, err := svc.send(context.Background(), ChannelWeCom, ChannelConfig{
		Webhook: "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=test-key",
	}, "【严重】存储服务异常")
	if err != nil {
		t.Fatal(err)
	}
	if result.StatusCode != http.StatusOK {
		t.Fatalf("status = %d", result.StatusCode)
	}
	if received["msgtype"] != "text" {
		t.Fatalf("msgtype = %#v", received["msgtype"])
	}
	text, ok := received["text"].(map[string]any)
	if !ok || text["content"] != "【严重】存储服务异常" {
		t.Fatalf("text payload = %#v", received["text"])
	}
}

func TestSendWeComRejectsPlatformError(t *testing.T) {
	svc := &Service{client: &http.Client{Transport: roundTripFunc(func(*http.Request) (*http.Response, error) {
		return &http.Response{
			StatusCode: http.StatusOK,
			Body:       io.NopCloser(strings.NewReader(`{"errcode":93000,"errmsg":"invalid webhook url"}`)),
			Header:     make(http.Header),
		}, nil
	})}}

	_, err := svc.send(context.Background(), ChannelWeCom, ChannelConfig{
		Webhook: "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=test-key",
	}, "test")
	if err == nil || !strings.Contains(err.Error(), "wecom rejected message") {
		t.Fatalf("platform error = %v", err)
	}
}

func TestTruncateUTF8BytesKeepsValidText(t *testing.T) {
	got := truncateUTF8Bytes(strings.Repeat("告", 1000), 2048)
	if len(got) > 2048 {
		t.Fatalf("truncated message is %d bytes", len(got))
	}
	if !strings.HasSuffix(got, "…") {
		t.Fatalf("truncated message lacks suffix: %q", got[len(got)-8:])
	}
}
