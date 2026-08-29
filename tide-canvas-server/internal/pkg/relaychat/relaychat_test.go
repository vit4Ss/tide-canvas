package relaychat

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestWebSearchOptionIsForwarded(t *testing.T) {
	var received chatRequest
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if err := json.NewDecoder(r.Body).Decode(&received); err != nil {
			t.Errorf("decode request: %v", err)
		}
		w.Header().Set("Content-Type", "text/event-stream")
		fmt.Fprint(w, "data: {\"choices\":[{\"delta\":{\"content\":\"ok\"}}]}\n\ndata: [DONE]\n\n")
	}))
	defer srv.Close()

	got, err := testClient(t, srv.URL).ChatWithWebSearch(context.Background(), "m", []Msg{TextMsg("user", "hi")}, true)
	if err != nil || got != "ok" {
		t.Fatalf("ChatWithWebSearch = %q, %v", got, err)
	}
	if !received.WebSearch {
		t.Fatal("web_search=true was not forwarded to relay")
	}
}

func TestHTTPErrorPreservesUpstreamDiagnostics(t *testing.T) {
	const body = `{"error":{"message":"maximum images exceeded","code":"too_many_images"}}`
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusRequestEntityTooLarge)
		_, _ = w.Write([]byte(body))
	}))
	defer srv.Close()

	_, err := testClient(t, srv.URL).Chat(context.Background(), "m", []Msg{TextMsg("user", "hi")})
	if err == nil {
		t.Fatal("expected upstream HTTP error")
	}
	var upstream *HTTPError
	if !errors.As(err, &upstream) {
		t.Fatalf("error type = %T, want *HTTPError", err)
	}
	if upstream.StatusCode != http.StatusRequestEntityTooLarge || upstream.Body != body {
		t.Fatalf("HTTP error details = %+v, want status/body preserved", upstream)
	}
	if upstream.URL != srv.URL+"/v1/chat/completions" || upstream.RequestBody == "" {
		t.Fatalf("HTTP error request details = %+v, want endpoint and payload", upstream)
	}
}

// 流式判活的两条口径，用一个假上游锁住：
//   1. 持续吐字的长回复不能被掐断（哪怕总时长超过任何单条 chunk 的间隔）
//   2. 连接开着但不再有数据 → 空闲看门狗必须在阈值附近结束，而不是挂到总上限
//
// 测试用真的 httptest 服务器走完整 HTTP 路径：只测解析器的话，正好漏掉这次
// 出问题的那一段（连接层的取消与阻塞读）。

// sseServer streams `n` delta frames, sleeping `gap` between them, then [DONE].
// stallAfter > 0 时在第 stallAfter 帧之后不再发送任何数据（连接保持打开）。
func sseServer(t *testing.T, n int, gap time.Duration, stallAfter int) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		w.WriteHeader(http.StatusOK)
		fl, _ := w.(http.Flusher)
		for i := 0; i < n; i++ {
			if stallAfter > 0 && i == stallAfter {
				// 卡住：不关连接、也不再写数据，等客户端自己放弃
				<-r.Context().Done()
				return
			}
			fmt.Fprintf(w, "data: {\"choices\":[{\"delta\":{\"content\":\"x\"}}]}\n\n")
			if fl != nil {
				fl.Flush()
			}
			time.Sleep(gap)
		}
		fmt.Fprint(w, "data: [DONE]\n\n")
		if fl != nil {
			fl.Flush()
		}
	}))
}

func TestNewDefaultsToTestRelay(t *testing.T) {
	c := New("", "test-key")
	if c == nil {
		t.Fatal("New returned nil with a key set")
	}
	if c.baseURL != "https://test-relay.tcmzhan.com" {
		t.Errorf("baseURL = %q, want test relay", c.baseURL)
	}
}

func TestNewUsesGenerousReasoningTimeouts(t *testing.T) {
	c := New("https://relay.example", "test-key")
	if c == nil {
		t.Fatal("New returned nil with a key set")
	}
	if c.idleTimeout != 15*time.Minute {
		t.Fatalf("idle timeout = %s, want 15m", c.idleTimeout)
	}
	transport, ok := c.hc.Transport.(*http.Transport)
	if !ok {
		t.Fatalf("transport type = %T, want *http.Transport", c.hc.Transport)
	}
	if transport.ResponseHeaderTimeout != 15*time.Minute {
		t.Fatalf("response header timeout = %s, want 15m", transport.ResponseHeaderTimeout)
	}
	if defaultStreamDeadline != 60*time.Minute {
		t.Fatalf("default stream deadline = %s, want 60m", defaultStreamDeadline)
	}
}

func testClient(t *testing.T, url string) *Client {
	t.Helper()
	c := New(url, "test-key")
	if c == nil {
		t.Fatal("New returned nil with a key set")
	}
	return c
}

// 持续有数据时，总时长即使远超单帧间隔也不该被中断。
func TestStreamKeepsAliveWhileProducing(t *testing.T) {
	srv := sseServer(t, 12, 40*time.Millisecond, 0)
	defer srv.Close()

	got, err := testClient(t, srv.URL).Chat(context.Background(), "m", []Msg{TextMsg("user", "hi")})
	if err != nil {
		t.Fatalf("stream errored while upstream was still producing: %v", err)
	}
	if got != strings.Repeat("x", 12) {
		t.Errorf("content = %q, want 12 deltas", got)
	}
}

// 断流后必须由空闲看门狗结束，并给出可辨认的错误（不能是笼统的 deadline）。
func TestStreamAbortsWhenIdle(t *testing.T) {
	srv := sseServer(t, 10, 10*time.Millisecond, 3)
	defer srv.Close()

	// 把阈值压到毫秒级，否则这条用例要跑满默认的 15 分钟。改的是本用例自己的 client
	// 实例，不碰包级常量，避免与其它用例仍在运行的看门狗抢同一个变量。
	cli := testClient(t, srv.URL)
	cli.idleTimeout, cli.idleCheck = 300*time.Millisecond, 50*time.Millisecond

	// 总上限远大于空闲阈值，确保结束的是看门狗而不是总时长
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	start := time.Now()
	_, err := cli.Chat(ctx, "m", []Msg{TextMsg("user", "hi")})
	elapsed := time.Since(start)

	if err == nil {
		t.Fatal("stalled stream returned no error")
	}
	if !strings.Contains(err.Error(), "idle") {
		t.Errorf("error should identify the idle abort, got: %v", err)
	}
	// 阈值 + 检查粒度 + 余量；同时确认没有一路挂到 30s 总上限
	if max := cli.idleTimeout + cli.idleCheck + 3*time.Second; elapsed > max {
		t.Errorf("idle abort took %s, want <= %s", elapsed.Round(time.Second), max)
	}
}

// 慢消费者不能拖死健康的流：onDelta 是同步写 SSE 给客户端的，客户端半开时那个
// 写能阻塞很久。这段时间不是上游断流，看门狗不该开火（否则等于把 chat 那边用
// context.WithoutCancel 解耦掉的「客户端断开不影响生成」又耦合回来）。
func TestSlowConsumerDoesNotTriggerIdleAbort(t *testing.T) {
	// 帧间隔 30ms（远小于空闲阈值，上游始终算活跃），但分多帧发送，保证慢消费
	// 之后还必须再回到 Read——否则数据早就全进了缓冲，读循环不再阻塞，这条用例
	// 就测不到东西了。
	const frames = 5
	srv := sseServer(t, frames, 30*time.Millisecond, 0)
	defer srv.Close()

	cli := testClient(t, srv.URL)
	cli.idleTimeout, cli.idleCheck = 100*time.Millisecond, 20*time.Millisecond

	// 每个 delta 都把读循环卡住 250ms，远超空闲阈值
	got, err := cli.ChatStream(context.Background(), "m", []Msg{TextMsg("user", "hi")},
		func(string) { time.Sleep(250 * time.Millisecond) })
	if err != nil {
		t.Fatalf("slow consumer killed a healthy stream: %v", err)
	}
	if got != strings.Repeat("x", frames) {
		t.Errorf("content = %q, want %d deltas", got, frames)
	}
}

// idleReader 只统计「正阻塞等待上游」的时间；不在等待中一律算 0。
func TestIdleReaderCountsOnlyWhileWaiting(t *testing.T) {
	ir := newIdleReader(bufio.NewReader(strings.NewReader("ab")))

	// 没有 Read 在途 → 不管过了多久都不算停滞
	time.Sleep(10 * time.Millisecond)
	if d := ir.stalledFor(); d != 0 {
		t.Errorf("stalledFor outside a read = %v, want 0", d)
	}

	if _, err := ir.Read(make([]byte, 2)); err != nil {
		t.Fatalf("read: %v", err)
	}
	if d := ir.stalledFor(); d != 0 {
		t.Errorf("stalledFor after a completed read = %v, want 0", d)
	}
}
