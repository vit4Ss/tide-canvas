package relaymedia

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestRHUpscaleOptionsAndSynchronousResults(t *testing.T) {
	cases := []struct {
		name   string
		params UpscaleParams
		fps    string
		level  string
	}{
		{name: "route defaults"},
		{name: "top level", params: UpscaleParams{OutputFPS: " 2X ", UpscaleModel: " MAX "}, fps: "2x", level: "max"},
		{name: "numeric fps", params: UpscaleParams{OutputFPS: 59.94, UpscaleModel: "high"}, fps: "59.94", level: "high"},
		{name: "integer fps", params: UpscaleParams{OutputFPS: 60}, fps: "60"},
		{name: "decimal JSON number", params: UpscaleParams{OutputFPS: json.Number("60.0")}, fps: "60"},
		{name: "legacy extras", params: UpscaleParams{Extras: map[string]any{"output_fps": "3x", "upscale_model": "medium", "prompt": "ignored"}}, fps: "3x", level: "medium"},
		{name: "top level wins", params: UpscaleParams{OutputFPS: "1x", UpscaleModel: "low", Extras: map[string]any{"output_fps": "invalid", "upscale_model": "invalid"}}, fps: "1x", level: "low"},
		{name: "independent fallback", params: UpscaleParams{OutputFPS: "4x", Extras: map[string]any{"output_fps": 24, "upscale_model": "max"}}, fps: "4x", level: "max"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			var body map[string]any
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Method != http.MethodPost || r.URL.Path != pathVideoUpscale {
					t.Errorf("unexpected request: %s %s", r.Method, r.URL.Path)
				}
				if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
					t.Errorf("decode body: %v", err)
				}
				_, _ = w.Write([]byte(`{"id":"rh_sync","status":"succeeded","data":[{"url":"https://cdn/rh.mp4"}]}`))
			}))
			defer srv.Close()
			p := tc.params
			p.Model = "rh-upscale"
			p.VideoURL = "https://example.com/source.mp4"
			p.TargetResolution = "4k"
			c := &Client{baseURL: srv.URL, apiKey: "test", hc: srv.Client()}
			res, err := c.UpscaleVideo(context.Background(), p)
			if err != nil || len(res.URLs) != 1 || res.URLs[0] != "https://cdn/rh.mp4" {
				t.Fatalf("result = %+v, error = %v", res, err)
			}
			want := map[string]any{"model": p.Model, "video": p.VideoURL, "target_resolution": "4k"}
			if tc.fps != "" {
				want["output_fps"] = tc.fps
			}
			if tc.level != "" {
				want["upscale_model"] = tc.level
			}
			gotJSON, _ := json.Marshal(body)
			wantJSON, _ := json.Marshal(want)
			if string(gotJSON) != string(wantJSON) {
				t.Fatalf("request = %s, want %s", gotJSON, wantJSON)
			}
		})
	}
}

func TestRHUpscaleAsyncPollsWithoutResubmitting(t *testing.T) {
	posts, polls := 0, 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodPost && r.URL.Path == pathVideoUpscale:
			posts++
			w.WriteHeader(http.StatusAccepted)
			_, _ = w.Write([]byte(`{"id":"rh_async","status":"processing","model":"rh-upscale"}`))
		case r.Method == http.MethodGet && r.URL.Path == "/v1/tasks/rh_async":
			polls++
			_, _ = w.Write([]byte(`{"id":"rh_async","status":"succeeded","output_url":"https://cdn/rh.mp4"}`))
		default:
			t.Errorf("unexpected request: %s %s", r.Method, r.URL.Path)
		}
	}))
	defer srv.Close()
	c := &Client{baseURL: srv.URL, apiKey: "test", hc: srv.Client()}
	res, err := c.UpscaleVideo(context.Background(), UpscaleParams{
		Model: "rh-upscale", VideoURL: "https://example.com/source.mp4", OutputFPS: "2x", UpscaleModel: "max",
	})
	if err != nil || res.TaskID != "rh_async" || len(res.URLs) != 1 || res.URLs[0] != "https://cdn/rh.mp4" || posts != 1 || polls != 1 {
		t.Fatalf("result = %+v, error = %v, posts = %d, polls = %d", res, err, posts, polls)
	}
}

func TestRHUpscaleRejectsInvalidOptionsBeforeSubmission(t *testing.T) {
	c := &Client{}
	cases := []struct {
		params UpscaleParams
		field  string
	}{
		{UpscaleParams{OutputFPS: "5x"}, "output_fps"},
		{UpscaleParams{OutputFPS: 61}, "output_fps"},
		{UpscaleParams{OutputFPS: true}, "output_fps"},
		{UpscaleParams{OutputFPS: "", Extras: map[string]any{"output_fps": "1x"}}, "output_fps"},
		{UpscaleParams{UpscaleModel: "ultra"}, "upscale_model"},
		{UpscaleParams{UpscaleModel: 1, Extras: map[string]any{"upscale_model": "max"}}, "upscale_model"},
		{UpscaleParams{UpscaleModel: "", Extras: map[string]any{"upscale_model": "max"}}, "upscale_model"},
		{UpscaleParams{Extras: map[string]any{"output_fps": "5x"}}, "output_fps"},
		{UpscaleParams{Extras: map[string]any{"upscale_model": 1}}, "upscale_model"},
	}
	for _, tc := range cases {
		p := tc.params
		p.Model = "rh-upscale"
		p.VideoURL = "https://example.com/source.mp4"
		if _, err := c.UpscaleVideo(context.Background(), p); err == nil || !strings.Contains(err.Error(), tc.field) {
			t.Errorf("invalid %+v: error = %v, want %s", p, err, tc.field)
		}
	}
}

func TestRHUpscaleUnknownSubmissionDoesNotRetry(t *testing.T) {
	requests := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests++
		w.WriteHeader(http.StatusBadGateway)
		_, _ = w.Write([]byte(`{"error":{"message":"submission_outcome_unknown","type":"submission_outcome_unknown","code":5011}}`))
	}))
	defer srv.Close()
	c := &Client{baseURL: srv.URL, apiKey: "test", hc: srv.Client()}
	_, err := c.UpscaleVideo(context.Background(), UpscaleParams{Model: "rh-upscale", VideoURL: "https://example.com/source.mp4"})
	var upstream *UpstreamError
	if !errors.As(err, &upstream) || upstream.Code != "5011" || requests != 1 {
		t.Fatalf("error = %v, requests = %d; want code 5011 and one submission", err, requests)
	}
}
