package relaymedia

import (
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

// 上游错误体两种真实形态都必须能解析（2026-07-13 用户实测：部分 400 返回
// {"error":"..."} 字符串形，严格对象结构曾把真实原因吞成 json 解析错误）。
func TestMediaErrorFlexibleUnmarshal(t *testing.T) {
	cases := []struct {
		name string
		body string
		want string
	}{
		{
			name: "object form",
			body: `{"status":"failed","error":{"message":"invalid resolution for quality low","type":"invalid_request_error","code":"bad_params"}}`,
			want: "invalid resolution for quality low",
		},
		{
			name: "string form",
			body: `{"error":"分辨率 2k 不支持 low 档"}`,
			want: "分辨率 2k 不支持 low 档",
		},
		{
			name: "numeric code",
			body: `{"error":{"message":"quota exceeded","code":400}}`,
			want: "quota exceeded",
		},
	}
	for _, tc := range cases {
		var mr mediaResp
		if err := json.Unmarshal([]byte(tc.body), &mr); err != nil {
			t.Errorf("%s: unmarshal failed: %v", tc.name, err)
			continue
		}
		if mr.Error == nil || mr.Error.Message != tc.want {
			t.Errorf("%s: error = %+v, want message %q", tc.name, mr.Error, tc.want)
		}
	}
	// numeric code round-trips as string
	var mr mediaResp
	_ = json.Unmarshal([]byte(`{"error":{"message":"m","code":400}}`), &mr)
	if mr.Error.Code != "400" {
		t.Errorf("numeric code = %q, want \"400\"", mr.Error.Code)
	}
}

func TestUpstreamErrorPreservesBusinessCode(t *testing.T) {
	t.Parallel()

	err := upstreamError(http.StatusBadGateway, mediaResp{
		Error: &mediaError{Message: "内容不符合要求", Type: "task_failed", Code: "5002"},
	}, nil)
	upstream, ok := err.(*UpstreamError)
	if !ok {
		t.Fatalf("error type = %T, want *UpstreamError", err)
	}
	if upstream.HTTPStatus != http.StatusBadGateway || upstream.Code != "5002" || upstream.Type != "task_failed" || upstream.Message != "内容不符合要求" {
		t.Fatalf("unexpected upstream error: %#v", upstream)
	}
	if got := upstream.Error(); got != "relaymedia: code 5002: 内容不符合要求" {
		t.Fatalf("Error() = %q", got)
	}
}

func TestSubmitReturnsStructuredErrorFromHTTPResponses(t *testing.T) {
	t.Parallel()

	for _, tc := range []struct {
		name       string
		httpStatus int
		codeJSON   string
		wantCode   string
	}{
		{name: "HTTP 200 numeric code", httpStatus: http.StatusOK, codeJSON: "5002", wantCode: "5002"},
		{name: "HTTP 502 string code", httpStatus: http.StatusBadGateway, codeJSON: `"5003"`, wantCode: "5003"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(tc.httpStatus)
				_, _ = fmt.Fprintf(w, `{
					"error":{"message":"内容不符合要求","type":"task_failed","code":%s},
					"id":"task_xxx",
					"status":"failed"
				}`, tc.codeJSON)
			}))
			defer server.Close()

			client := &Client{baseURL: server.URL, hc: server.Client()}
			_, err := client.submit(context.Background(), "/v1/images/generations", map[string]any{}, time.Second)
			var upstream *UpstreamError
			if !errors.As(err, &upstream) {
				t.Fatalf("error type = %T, want *UpstreamError", err)
			}
			if upstream.HTTPStatus != tc.httpStatus || upstream.Code != tc.wantCode || upstream.Message != "内容不符合要求" {
				t.Fatalf("unexpected upstream error: %#v", upstream)
			}
		})
	}
}

// Suno 实测(2026-07-18)同步 200 的 data 只带主歌:两首全集与 clip_id 只在
// /v1/tasks/{id}。同步成功后必须补查任务详情,否则第二首歌与延长/翻唱引用全丢。
func TestSubmitAudioSyncEnrichesFromTaskDetail(t *testing.T) {
	const detail = `{"id":"task_x","status":"succeeded",
		"output_urls":["https://cdn/a.mp3","https://cdn/b.mp3"],
		"tracks":[{"clip_id":"c1","title":"Song A","audio_url":"https://cdn/a.mp3"},
		          {"clip_id":"c2","title":"Song B","audio_url":"https://cdn/b.mp3"}]}`
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case pathAudioSpeech:
			w.Write([]byte(`{"id":"task_x","status":"succeeded","data":[{"url":"https://cdn/a.mp3"}],"audio":{"url":"https://cdn/a.mp3"}}`))
		case "/v1/tasks/task_x":
			w.Write([]byte(detail))
		default:
			t.Errorf("unexpected path %s", r.URL.Path)
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer srv.Close()

	c := &Client{baseURL: srv.URL, apiKey: "k", hc: srv.Client()}
	res, err := c.submit(context.Background(), pathAudioSpeech, map[string]any{"model": "m", "input": "p"}, 5*time.Second)
	if err != nil {
		t.Fatalf("submit: %v", err)
	}
	if len(res.URLs) != 2 || res.URLs[1] != "https://cdn/b.mp3" {
		t.Errorf("URLs = %v, want both songs from task detail", res.URLs)
	}
	if len(res.Tracks) != 2 || res.Tracks[0].ClipID != "c1" || res.Tracks[1].ClipID != "c2" {
		t.Errorf("Tracks = %+v, want clip ids c1/c2", res.Tracks)
	}
}

// 详情接口失败时不致命:保留内联的单首结果,生成不因补查而变失败。
func TestSubmitAudioSyncKeepsInlineWhenDetailFails(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case pathAudioSpeech:
			w.Write([]byte(`{"id":"task_x","status":"succeeded","data":[{"url":"https://cdn/a.mp3"}]}`))
		default:
			w.WriteHeader(http.StatusInternalServerError)
		}
	}))
	defer srv.Close()

	c := &Client{baseURL: srv.URL, apiKey: "k", hc: srv.Client()}
	res, err := c.submit(context.Background(), pathAudioSpeech, map[string]any{"model": "m", "input": "p"}, 5*time.Second)
	if err != nil {
		t.Fatalf("submit: %v", err)
	}
	if len(res.URLs) != 1 || res.URLs[0] != "https://cdn/a.mp3" {
		t.Errorf("URLs = %v, want inline main song kept", res.URLs)
	}
}

func TestGenerate3DAsyncPreservesAssetsAndPromotesGLB(t *testing.T) {
	var submitted map[string]any
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if got := r.Header.Get("Authorization"); got != "Bearer relay-key" {
			t.Errorf("Authorization = %q", got)
		}
		switch {
		case r.Method == http.MethodPost && r.URL.Path == path3DGenerations:
			if err := json.NewDecoder(r.Body).Decode(&submitted); err != nil {
				t.Fatalf("decode submit body: %v", err)
			}
			w.WriteHeader(http.StatusAccepted)
			_, _ = w.Write([]byte(`{"id":"task_3d","status":"processing","model":"hy-3d-3.1"}`))
		case r.Method == http.MethodGet && r.URL.Path == "/v1/tasks/task_3d":
			_, _ = w.Write([]byte(`{
				"id":"task_3d","status":"succeeded","output_url":"https://cdn/dog.glb",
				"assets":[
					{"type":"obj","url":"https://cdn/dog.obj","preview_image_url":"https://cdn/dog.png"},
					{"type":"glb","url":"https://cdn/dog.glb","preview_image_url":"https://cdn/dog.png"}
				]
			}`))
		default:
			t.Errorf("unexpected request %s %s", r.Method, r.URL.Path)
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer srv.Close()

	c := &Client{baseURL: srv.URL, apiKey: "relay-key", hc: srv.Client()}
	res, err := c.Generate3D(context.Background(), ThreeDParams{
		Model:        "hy-3d-3.1",
		Prompt:       "一只小狗",
		EnablePBR:    true,
		FaceCount:    500000,
		GenerateType: "Normal",
	})
	if err != nil {
		t.Fatalf("Generate3D: %v", err)
	}
	if len(res.URLs) != 2 || res.URLs[0] != "https://cdn/dog.glb" || res.URLs[1] != "https://cdn/dog.obj" {
		t.Fatalf("URLs = %v, want GLB promoted before OBJ", res.URLs)
	}
	if len(res.Assets) != 2 || res.Assets[0].PreviewImageURL != "https://cdn/dog.png" {
		t.Fatalf("Assets = %+v", res.Assets)
	}
	if submitted["model"] != "hy-3d-3.1" || submitted["prompt"] != "一只小狗" || submitted["enable_pbr"] != true {
		t.Fatalf("submit body = %#v", submitted)
	}
	if got := int(submitted["face_count"].(float64)); got != 500000 {
		t.Fatalf("face_count = %d", got)
	}
}

func TestGenerate3DRejectsConflictingAndDuplicateInputs(t *testing.T) {
	c := &Client{}
	if _, err := c.Generate3D(context.Background(), ThreeDParams{
		Model: "hy-3d-3.1", Prompt: "dog", ImageURL: "https://cdn/dog.png",
	}); err == nil || !strings.Contains(err.Error(), "cannot be used together") {
		t.Fatalf("prompt + image error = %v", err)
	}
	if _, err := c.Generate3D(context.Background(), ThreeDParams{
		Model: "hy-3d-3.1",
		MultiViewImages: []ThreeDViewImage{
			{ViewType: "front", ViewImageURL: "https://cdn/front.png"},
			{ViewType: "front", ViewImageURL: "https://cdn/front-2.png"},
		},
	}); err == nil || !strings.Contains(err.Error(), "duplicate") {
		t.Fatalf("duplicate view error = %v", err)
	}
}

// 超分走 202 + /v1/tasks/{id} 轮询;请求体只有 model/video/target_resolution,
// 不带 prompt(该接口不接收)。成功后从 output_url / data[0].url 读输出视频。
func TestUpscaleVideoAsyncPollsToOutputURL(t *testing.T) {
	var submitted map[string]any
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodPost && r.URL.Path == pathVideoUpscale:
			if err := json.NewDecoder(r.Body).Decode(&submitted); err != nil {
				t.Fatalf("decode submit body: %v", err)
			}
			w.WriteHeader(http.StatusAccepted)
			_, _ = w.Write([]byte(`{"id":"task_up","object":"video.upscale","status":"processing","model":"wavespeed-ai/video-upscaler"}`))
		case r.Method == http.MethodGet && r.URL.Path == "/v1/tasks/task_up":
			_, _ = w.Write([]byte(`{
				"id":"task_up","object":"video.upscale","status":"succeeded",
				"model":"wavespeed-ai/video-upscaler",
				"output_url":"https://cdn/upscaled.mp4",
				"data":[{"url":"https://cdn/upscaled.mp4"}]
			}`))
		default:
			t.Errorf("unexpected request %s %s", r.Method, r.URL.Path)
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer srv.Close()

	c := &Client{baseURL: srv.URL, apiKey: "k", hc: srv.Client()}
	res, err := c.UpscaleVideo(context.Background(), UpscaleParams{
		Model:            "wavespeed-ai/video-upscaler",
		VideoURL:         "https://example.com/input.mp4",
		TargetResolution: "4K", // 大小写归一后发 "4k"
	})
	if err != nil {
		t.Fatalf("UpscaleVideo: %v", err)
	}
	if len(res.URLs) != 1 || res.URLs[0] != "https://cdn/upscaled.mp4" {
		t.Fatalf("URLs = %v, want upscaled output", res.URLs)
	}
	if res.TaskID != "task_up" {
		t.Fatalf("TaskID = %q", res.TaskID)
	}
	if submitted["model"] != "wavespeed-ai/video-upscaler" || submitted["video"] != "https://example.com/input.mp4" || submitted["target_resolution"] != "4k" {
		t.Fatalf("submit body = %#v", submitted)
	}
	if _, has := submitted["prompt"]; has {
		t.Fatal("upscale body must not carry a prompt")
	}
}

func TestUpscaleVideoRejectsInvalidInput(t *testing.T) {
	c := &Client{}
	if _, err := c.UpscaleVideo(context.Background(), UpscaleParams{Model: "m"}); err == nil ||
		!strings.Contains(err.Error(), "video url") {
		t.Fatalf("missing video error = %v", err)
	}
	if _, err := c.UpscaleVideo(context.Background(), UpscaleParams{
		Model: "m", VideoURL: "ftp://example.com/in.mp4",
	}); err == nil || !strings.Contains(err.Error(), "http(s)") {
		t.Fatalf("non-http video error = %v", err)
	}
	if _, err := c.UpscaleVideo(context.Background(), UpscaleParams{
		Model: "m", VideoURL: "https://example.com/in.mp4", TargetResolution: "8k",
	}); err == nil || !strings.Contains(err.Error(), "target_resolution") {
		t.Fatalf("bad resolution error = %v", err)
	}
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
