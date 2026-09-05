package social

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"reflect"
	"strings"
	"testing"
)

func bilibiliFixture(t *testing.T) map[string]any {
	t.Helper()
	body, err := os.ReadFile("testdata/bilibili-view.json")
	if err != nil {
		t.Fatal(err)
	}
	var data map[string]any
	decoder := json.NewDecoder(strings.NewReader(string(body)))
	decoder.UseNumber()
	if err := decoder.Decode(&data); err != nil {
		t.Fatal(err)
	}
	return data
}

func TestBilibiliPublicResponseMetricsAndOwner(t *testing.T) {
	// Public counters/IDs from the exact video in the bug report; the fixture
	// reduces metadata and replaces media URLs with example hosts. Wrappers
	// reflect TikHub's envelope and Bilibili's own code/data envelope.
	data := bilibiliFixture(t)
	for _, wrapper := range []string{"data", "View", "videoData", "video_info"} {
		t.Run(wrapper, func(t *testing.T) {
			input := map[string]any{wrapper: data, "related": []any{map[string]any{
				"bvid": "BV1Wrong0000", "title": "Wrong video", "owner": map[string]any{"name": "Wrong author"},
				"stat": map[string]any{"like": 999999}, "video_url": "https://cdn.example/unrelated.mp4",
			}}}
			work := normalizeWork(input, "")
			want := metricVO{Play: "89652", Like: "853", Comment: "398", Share: "289", Favorite: "1714", Coin: "440", Danmaku: "19"}
			if work.Stats != want || work.ID != "BV1114y1X7TA" || work.Duration != "04:55" || work.MediaType != "video" || work.MediaURL != "" {
				t.Fatalf("unexpected work: %+v", work)
			}
			profile := bilibiliProfile(bilibiliWorkRoot(input, 0))
			if profile == nil || profile.Name != "IT常识" || profile.ID != "256455508" || profile.AvatarURL == "" || profile.Likes != "" {
				t.Fatalf("unexpected author: %+v", profile)
			}
		})
	}
}

func TestBilibiliMissingMetricsDoNotBorrowRelatedStats(t *testing.T) {
	input := map[string]any{
		"bvid": "BV1114y1X7TA", "title": "video", "stat": map[string]any{"view": 0, "like": 0},
		"related": map[string]any{"stat": map[string]any{"reply": 10, "favorite": 20, "share": 30}},
	}
	work := normalizeWork(input, "")
	if work.Stats != (metricVO{Play: "0", Like: "0"}) {
		t.Fatalf("missing became zero or borrowed another video's stats: %+v", work.Stats)
	}
	listWork := normalizeWork(map[string]any{"bvid": "BV1114y1X7TA", "comment": 7, "play": 123}, "")
	if listWork.Stats.Comment != "7" || listWork.Stats.Play != "123" || listWork.Stats.Like != "" {
		t.Fatalf("vlist fields = %+v", listWork.Stats)
	}
}

func TestBilibiliMediaAcceptsCompleteMP4AndMirrorsOnly(t *testing.T) {
	for _, tc := range []struct {
		name, body string
		want       []string
	}{
		{"progressive", `{"data":{"durl":[{"url":"https://cdn.example/a.mp4?token=abc","backup_url":["https://backup.example/a.mp4","https://cdn.example/a.mp4?token=abc"]}]}}`, []string{"https://cdn.example/a.mp4?token=abc", "https://backup.example/a.mp4"}},
		{"nested alias", `{"video_data":{"nwm_video_url":"https://cdn.example/a.mp4"}}`, []string{"https://cdn.example/a.mp4"}},
		{"dash only", `{"dash":{"video":[{"baseUrl":"https://cdn.example/video.mp4"}],"audio":[{"baseUrl":"https://cdn.example/audio.m4s"}]}}`, nil},
		{"segments", `{"durl":[{"url":"https://cdn.example/a.mp4"},{"url":"https://cdn.example/b.mp4"}]}`, nil},
		{"flv", `{"durl":[{"url":"https://cdn.example/a.flv"}]}`, nil},
		{"related", `{"related":{"video_url":"https://cdn.example/a.mp4"}}`, nil},
		{"audio", `{"video_url":"https://cdn.example/a.m4a"}`, nil},
		{"private", `{"video_url":"http://127.0.0.1/a.mp4"}`, nil},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var data any
			if err := json.Unmarshal([]byte(tc.body), &data); err != nil {
				t.Fatal(err)
			}
			if got := bilibiliMediaURLs(data, 0); !reflect.DeepEqual(got, tc.want) {
				t.Fatalf("media = %#v, want %#v", got, tc.want)
			}
		})
	}
}

func TestBilibiliInspectEnrichesSparseV3AndFetchesPlayback(t *testing.T) {
	fixture := bilibiliFixture(t)
	var calls []string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls = append(calls, r.URL.RequestURI())
		if r.Header.Get("Authorization") != "Bearer test-key" {
			t.Error("missing upstream authorization")
		}
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/api/v1/bilibili/web/fetch_one_video_v3":
			_, _ = w.Write([]byte(`{"code":200,"data":{"videoData":{"bvid":"BV1114y1X7TA","title":"original","stat":{"view":89652}}}}`))
		case "/api/v1/bilibili/web/fetch_one_video":
			if r.URL.Query().Get("bv_id") != "BV1114y1X7TA" {
				t.Error("incorrect bv_id")
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"code": 200, "data": fixture})
		case "/api/v1/bilibili/web/fetch_video_play_info":
			_, _ = w.Write([]byte(`{"code":200,"data":{"dash":{"video":[{"baseUrl":"https://cdn.example/silent.m4s"}]}}}`))
		case "/api/v1/bilibili/web/fetch_video_playurl":
			if r.URL.Query().Get("bv_id") != "BV1114y1X7TA" || r.URL.Query().Get("cid") != "1211226722" {
				t.Error("incorrect playurl parameters")
			}
			_, _ = w.Write([]byte(`{"code":200,"data":{"data":{"durl":[{"url":"https://cdn.example/complete.mp4"}]}}}`))
		default:
			t.Errorf("unexpected request: %s", r.URL)
			w.WriteHeader(500)
		}
	}))
	defer server.Close()
	h := &handler{httpcli: server.Client()}
	source, _ := url.Parse("https://www.bilibili.com/video/BV1114y1X7TA?spm_id_from=test")
	result, err := h.inspectContent(context.Background(), settings{baseURL: server.URL, apiKey: "test-key"}, platformBilibili, source)
	if err != nil {
		t.Fatal(err)
	}
	if len(calls) != 4 || result.Content.Stats.Like != "853" || result.Content.Stats.Comment != "398" || result.Content.MediaURL != "https://cdn.example/complete.mp4" || result.Profile == nil || result.Profile.Name != "IT常识" || len(result.Warnings) != 0 {
		t.Fatalf("result=%+v work=%+v calls=%v", result, result.Content, calls)
	}
}

func TestBilibiliInspectKeepsPartialDataWhenSupplementFails(t *testing.T) {
	var calls int
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		w.Header().Set("Content-Type", "application/json")
		if strings.HasSuffix(r.URL.Path, "fetch_one_video_v3") {
			_, _ = w.Write([]byte(`{"code":200,"data":{"bvid":"BV1114y1X7TA","title":"kept","stat":{"view":123,"like":0}}}`))
		} else {
			w.WriteHeader(503)
		}
	}))
	defer server.Close()
	h := &handler{httpcli: server.Client()}
	source, _ := url.Parse("https://www.bilibili.com/video/BV1114y1X7TA")
	result, err := h.inspectContent(context.Background(), settings{baseURL: server.URL}, platformBilibili, source)
	if err != nil || result.Content.Title != "kept" || result.Content.Stats.Like != "0" || result.Content.Stats.Comment != "" || len(result.Warnings) != 2 || calls != 3 {
		t.Fatalf("result=%+v err=%v calls=%d", result, err, calls)
	}
}

func TestBilibiliCIDRespectsSelectedPart(t *testing.T) {
	item := map[string]any{"cid": 1, "pages": []any{map[string]any{"page": 1, "cid": 1}, map[string]any{"page": 2, "cid": 2}}}
	for _, tc := range []struct{ query, want string }{{"", "1"}, {"?p=2", "2"}, {"?p=3", ""}, {"?p=abc", ""}, {"?p=0", ""}} {
		source, _ := url.Parse("https://www.bilibili.com/video/BV1114y1X7TA" + tc.query)
		if got := bilibiliCID(item, source); got != tc.want {
			t.Errorf("cid %s = %s, want %s", tc.query, got, tc.want)
		}
	}
}

func TestBilibiliFallbackRecoveryAndIdentityIsolation(t *testing.T) {
	for _, tc := range []struct {
		name, primary, supplement string
		wantTitle                 string
	}{
		{"primary fails", `{"code":500,"message":"temporarily unavailable"}`, `{"code":200,"data":{"bvid":"BV1114y1X7TA","title":"recovered","media_url":"https://cdn.example/a.mp4","stat":{"like":0}}}`, "recovered"},
		{"wrong supplement", `{"code":200,"data":{"bvid":"BV1114y1X7TA","title":"original","media_url":"https://cdn.example/a.mp4","stat":{"like":0}}}`, `{"code":200,"data":{"bvid":"BV1Wrong0000","title":"wrong","stat":{"like":9999}}}`, "original"},
		{"partial supplement", `{"code":200,"data":{"bvid":"BV1114y1X7TA","title":"original","media_url":"https://cdn.example/a.mp4","stat":{"view":123,"like":0}}}`, `{"code":200,"data":{"bvid":"BV1114y1X7TA","title":"updated","stat":{"reply":3,"share":null}}}`, "updated"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			calls := 0
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				calls++
				w.Header().Set("Content-Type", "application/json")
				if strings.HasSuffix(r.URL.Path, "fetch_one_video_v3") {
					_, _ = w.Write([]byte(tc.primary))
				} else {
					_, _ = w.Write([]byte(tc.supplement))
				}
			}))
			defer server.Close()
			h := &handler{httpcli: server.Client()}
			source, _ := url.Parse("https://www.bilibili.com/video/BV1114y1X7TA")
			got, err := h.inspectContent(context.Background(), settings{baseURL: server.URL}, platformBilibili, source)
			if err != nil {
				t.Fatal(err)
			}
			if calls != 2 || got.Content.Title != tc.wantTitle || got.Content.Stats.Like != "0" || got.Content.MediaURL != "https://cdn.example/a.mp4" {
				t.Fatalf("calls=%d work=%+v", calls, got.Content)
			}
			if tc.name == "partial supplement" && (got.Content.Stats.Play != "123" || got.Content.Stats.Comment != "3" || got.Content.Stats.Share != "") {
				t.Fatalf("lost partial metrics: %+v", got.Content.Stats)
			}
		})
	}
}

func TestBilibiliSelectedPartNeverUsesFirstPartStream(t *testing.T) {
	item := bilibiliWorkRoot(bilibiliFixture(t), 0)
	item["media_url"] = "https://cdn.example/first.mp4"
	item["pages"] = []any{map[string]any{"page": 1, "cid": 1, "duration": 295}, map[string]any{"page": 2, "cid": 2, "duration": 30}}
	var calls []string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls = append(calls, r.URL.Path)
		w.Header().Set("Content-Type", "application/json")
		if strings.HasSuffix(r.URL.Path, "fetch_one_video_v3") {
			_ = json.NewEncoder(w).Encode(map[string]any{"code": 200, "data": item})
		} else if strings.HasSuffix(r.URL.Path, "fetch_video_playurl") && r.URL.Query().Get("cid") == "2" {
			_, _ = w.Write([]byte(`{"code":200,"data":{"durl":[{"url":"https://cdn.example/second.mp4"}]}}`))
		} else {
			t.Errorf("unexpected endpoint %s", r.URL)
			w.WriteHeader(500)
		}
	}))
	defer server.Close()
	h := &handler{httpcli: server.Client()}
	source, _ := url.Parse("https://www.bilibili.com/video/BV1114y1X7TA?p=2")
	got, err := h.inspectContent(context.Background(), settings{baseURL: server.URL}, platformBilibili, source)
	if err != nil {
		t.Fatal(err)
	}
	if got.Content.MediaURL != "https://cdn.example/second.mp4" || got.Content.Duration != "00:30" || len(calls) != 2 {
		t.Fatalf("wrong part: %+v; calls %v", got.Content, calls)
	}
}

func TestBilibiliCancelledRequestDoesNotStartFallbacks(t *testing.T) {
	calls := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { calls++; w.WriteHeader(500) }))
	defer server.Close()
	h := &handler{httpcli: server.Client()}
	source, _ := url.Parse("https://www.bilibili.com/video/BV1114y1X7TA")
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	_, err := h.inspectContent(ctx, settings{baseURL: server.URL}, platformBilibili, source)
	if err == nil || calls != 0 {
		t.Fatalf("err=%v calls=%d", err, calls)
	}
}
