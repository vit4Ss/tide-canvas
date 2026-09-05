package videodownload

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"tidecanvas/internal/config"
)

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }
func responseFor(r *http.Request, body, contentType string) *http.Response {
	return &http.Response{StatusCode: 200, Header: http.Header{"Content-Type": []string{contentType}}, Body: io.NopCloser(strings.NewReader(body)), ContentLength: int64(len(body)), Request: r}
}
func testService(t *testing.T) *Service {
	t.Helper()
	binary, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	s := New(config.VideoDownloaderConfig{Enabled: true, Command: binary, FFmpegCommand: binary, FFprobeCommand: binary, JSRuntime: binary, TempDir: t.TempDir(), MaxFileBytes: 1024, MaxConcurrent: 1, MaxConcurrentResolves: 1, ResolveTimeout: 2 * time.Second, DownloadTimeout: 5 * time.Second})
	s.client = &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
		t.Errorf("unexpected network access %s", r.URL)
		return nil, errors.New("unexpected network")
	})}
	s.run = func(context.Context, string, []string, string, int64) ([]byte, []byte, error) {
		t.Error("unexpected command")
		return nil, nil, errors.New("unexpected command")
	}
	return s
}
func requireError(t *testing.T, err error, status int) {
	t.Helper()
	var e *Error
	if !errors.As(err, &e) || e.Status != status {
		t.Fatalf("error %v, want status %d", err, status)
	}
}

func TestPublicPlatformLinks(t *testing.T) {
	accepted := map[string]string{
		"https://www.bilibili.com/video/BV1114y1X7TA?p=2": "bilibili", "https://b23.tv/AbCdEf": "bilibili",
		"https://www.douyin.com/jingxuan?modal_id=7669082935156313379": "douyin", "https://v.douyin.com/abc123/": "douyin",
		"https://v.kuaishou.com/ABC123": "kuaishou", "https://www.kwai.com/@user/video/123": "kuaishou",
		"https://www.pinterest.com/pin/123456/": "pinterest", "https://pin.it/abc123": "pinterest",
		"https://www.tiktok.com/@user/video/123456": "tiktok", "https://vm.tiktok.com/abc123/": "tiktok",
		"https://www.instagram.com/reel/abc123/": "instagram", "https://youtu.be/abcdefghijk": "youtube", "https://www.youtube.com/watch?v=abcdefghijk&list=other": "youtube",
	}
	for raw, want := range accepted {
		t.Run(raw, func(t *testing.T) {
			normalized, p, err := ValidateSource(raw)
			if err != nil || p != want {
				t.Fatalf("%s %s %v", normalized, p, err)
			}
			if strings.Contains(raw, "modal_id") && !strings.Contains(normalized, "/video/7669082935156313379") {
				t.Fatal(normalized)
			}
		})
	}
	for _, raw := range []string{"file:///etc/passwd", "https://127.0.0.1/video/1", "https://youtube.com.evil.test/watch?v=a", "https://www.youtube.com:8443/watch?v=a", "https://user:pass@youtube.com/watch?v=a", "https://youtube.com/playlist?list=1", "https://youtube.com/@user", "https://www.douyin.com/user/id?modal_id=12345", "https://www.douyin.com/jingxuan?modal_id=12345&modal_id=23456", "https://bilibili.com/search", "--exec=echo injected"} {
		if _, _, err := ValidateSource(raw); err == nil {
			t.Fatalf("unsafe/non-video accepted %q", raw)
		}
	}
}

func TestDouyinSelectsRequestedItemAndChecksRestrictions(t *testing.T) {
	body := `<script>window._ROUTER_DATA={"loaderData":{"recommend":{"aweme_id":"99999","desc":"wrong","video":{"play_addr":{"url_list":["https://v.douyinvod.com/wrong.mp4"]}}},"current":{"aweme_id":"12345","desc":"A+B 测试","video":{"duration":42000,"width":1920,"height":1080,"cover":{"url_list":["https://example.com/cover.jpg"]},"bit_rate":[{"is_h265":1,"play_addr":{"width":3840,"height":2160,"data_size":90,"url_list":["https://v.douyinvod.com/4k.mp4"]}},{"is_h265":0,"play_addr":{"width":1920,"height":1080,"data_size":40,"url_list":["http://v.douyinvod.com/1080.mp4"]}}]}}}};moreJS();</script>`
	plan, err := parseDouyin(body, "12345", "compat")
	if err != nil || plan == nil || plan.Title != "A+B 测试" || plan.Height != 1080 || plan.Parts[0].URLs[0] != "https://v.douyinvod.com/1080.mp4" {
		t.Fatalf("wrong video: %+v %v", plan, err)
	}
	plan, err = parseDouyin(body, "12345", "quality")
	if err != nil || plan.Height != 2160 {
		t.Fatalf("highest quality missing: %+v %v", plan, err)
	}
	for _, extra := range []string{`"status":{"is_private":true},`, `"status":{"is_delete":1},`, `"images":[{"url":"image.jpg"}],`} {
		_, err = parseDouyin(strings.Replace(body, `"desc":"A+B 测试",`, extra+`"desc":"A+B 测试",`, 1), "12345", "quality")
		requireError(t, err, 400)
	}
	jsonBody := strings.Split(strings.Split(body, "window._ROUTER_DATA=")[1], ";moreJS")[0]
	plan, err = parseDouyin(`<script id="RENDER_DATA">`+url.PathEscape(jsonBody)+`</script>`, "12345", "compat")
	if err != nil || plan == nil || plan.Title != "A+B 测试" {
		t.Fatalf("render data failed %+v %v", plan, err)
	}
}

func TestSharePageSelectsPublicMediaAndMetadata(t *testing.T) {
	body := `<meta content="作品 &amp; 标题" property="og:title"><meta property="og:image" content="https://example.com/image.jpg"><video><source src="https://v.kwimgs.com/abc_hd.mp4"><source src="https://v.kwimgs.com/abc_b_.mp4"></video><script>"https://internal.invalid/wrong.mp4"</script>`
	plan := parseSharePage(body, "https://v.kuaishou.com/abc", "kuaishou", "speed")
	if plan == nil || plan.Title != "作品 & 标题" || !strings.Contains(plan.Parts[0].URLs[0], "_b_") {
		t.Fatalf("share result %+v", plan)
	}
	if parseSharePage(`<video src="https://127.0.0.1/private.mp4"></video>`, "https://v.kuaishou.com/abc", "kuaishou", "compat") != nil {
		t.Fatal("unsafe media accepted")
	}
	primary := parseSharePage(body+`<meta property="og:video" content="https://v.kwimgs.com/requested.mp4">`, "https://v.kuaishou.com/abc", "kuaishou", "compat")
	if primary == nil || primary.Parts[0].URLs[0] != "https://v.kwimgs.com/requested.mp4" {
		t.Fatal("primary video lost to an embedded recommendation")
	}
	if parseSharePage(`<script>"https://v.kwimgs.com/first.mp4" "https://v.kwimgs.com/recommended_hd.mp4"</script>`, "https://v.kuaishou.com/abc", "kuaishou", "compat") != nil {
		t.Fatal("ambiguous script URLs must use the platform extractor")
	}
}

func TestSharePageRejectsUnrelatedPlayers(t *testing.T) {
	for _, body := range []string{
		`<video src="https://v.kwimgs.com/current.mp4"></video><video src="https://v.kwimgs.com/recommended_hd.mp4"></video>`,
		`<script type="application/ld+json">[{"@type":"VideoObject","contentUrl":"https://v.kwimgs.com/current.mp4"},{"@type":"VideoObject","contentUrl":"https://v.kwimgs.com/recommended_hd.mp4"}]</script>`,
	} {
		if parseSharePage(body, "https://v.kuaishou.com/abc", "kuaishou", "compat") != nil {
			t.Fatal("unrelated players must be resolved by the platform extractor")
		}
		plan := parseSharePage(body+`<meta property="og:video" content="https://v.kwimgs.com/current.mp4">`, "https://v.kuaishou.com/abc", "kuaishou", "compat")
		if plan == nil || plan.Parts[0].URLs[0] != "https://v.kwimgs.com/current.mp4" {
			t.Fatal("explicit primary metadata must override recommendations")
		}
	}
	body := `<script type="application/ld+json">{"@type":"VideoObject","contentUrl":"https://v.kwimgs.com/current_hd.mp4"}</script><video><source src="https://v.kwimgs.com/current_hd.mp4"><source src="https://v.kwimgs.com/current_b_.mp4"></video>`
	plan := parseSharePage(body, "https://v.kuaishou.com/abc", "kuaishou", "speed")
	if plan == nil || plan.Parts[0].URLs[0] != "https://v.kwimgs.com/current_b_.mp4" {
		t.Fatal("matching metadata and player must retain quality alternatives")
	}
}

func TestSharePageValidatesRedirectDestination(t *testing.T) {
	for _, tc := range []struct {
		path  string
		valid bool
	}{
		{"https://www.kuaishou.com/short-video/abc123", true},
		{"https://www.kuaishou.com/fw/photo/abc123", true},
		{"https://www.kuaishou.com/profile/abc123", false},
		{"https://www.kuaishou.com/", false},
		{"https://www.kuaishou.com/login", false},
		{"https://www.pinterest.com/pin/123456", false},
	} {
		t.Run(tc.path, func(t *testing.T) {
			s := testService(t)
			s.client.Transport = roundTripFunc(func(r *http.Request) (*http.Response, error) {
				final := r.Clone(r.Context())
				final.URL, _ = url.Parse(tc.path)
				return responseFor(final, `<video src="https://v.kwimgs.com/current.mp4"></video>`, "text/html"), nil
			})
			plan, err := s.sharePage(context.Background(), "https://v.kuaishou.com/abc123", "kuaishou", "compat")
			if tc.valid {
				if err != nil || plan == nil {
					t.Fatalf("valid video redirect rejected: %v", err)
				}
			} else {
				requireError(t, err, 400)
			}
		})
	}
}

func TestBilibiliPartsAndDASH(t *testing.T) {
	for _, dash := range []bool{false, true} {
		t.Run(fmt.Sprint(dash), func(t *testing.T) {
			s := testService(t)
			s.cfg.MaxFileBytes = 1 << 20
			s.client.Transport = roundTripFunc(func(r *http.Request) (*http.Response, error) {
				if r.URL.Host != "api.bilibili.com" {
					t.Fatalf("unexpected host %s", r.URL.Host)
				}
				if r.URL.Path == "/x/web-interface/view" {
					return responseFor(r, `{"code":0,"data":{"state":0,"title":"分P视频","owner":{"name":"UP"},"dimension":{"width":1920,"height":1080},"pages":[{"cid":1,"part":"第一P","duration":10},{"cid":2,"part":"第二P","duration":20}]}}`, "application/json"), nil
				}
				if r.URL.Query().Get("cid") != "2" || r.URL.Query().Get("qn") != "80" {
					t.Fatalf("wrong playback parameters %s", r.URL)
				}
				body := `{"code":0,"data":{"quality":32,"format":"mp4","durl":[{"url":"https://cdn.bilivideo.com/video.mp4","size":100}]}}`
				if dash {
					body = `{"code":0,"data":{"dash":{"video":[{"baseUrl":"https://cdn.bilivideo.com/4k.m4s","width":3840,"height":2160,"codecs":"avc1","bandwidth":10000},{"baseUrl":"https://cdn.bilivideo.com/video.m4s","width":1920,"height":1080,"codecs":"avc1","bandwidth":1000}],"audio":[{"baseUrl":"https://cdn.bilivideo.com/audio.m4s","codecs":"mp4a","bandwidth":100}]}}}`
				}
				return responseFor(r, body, "application/json"), nil
			})
			p, err := s.bilibili(context.Background(), "https://www.bilibili.com/video/BV1114y1X7TA?p=2", "compat")
			if err != nil || p == nil || !strings.Contains(p.Title, "第二P") {
				t.Fatalf("plan %+v %v", p, err)
			}
			if dash && (p.Audio == nil || p.Height != 1080 || p.EstimatedBytes != 2750) {
				t.Fatalf("DASH plan %+v", p)
			}
			if !dash && (p.Height != 480 || p.EstimatedBytes != 100) {
				t.Fatalf("public resolution %+v", p)
			}
		})
	}
}

func TestExtractorMetadataAndLimits(t *testing.T) {
	s := testService(t)
	s.run = func(ctx context.Context, binary string, args []string, dir string, limit int64) ([]byte, []byte, error) {
		joined := strings.Join(args, " ")
		for _, required := range []string{"--ignore-config", "--no-plugin-dirs", "--proxy http://video:", "--no-playlist", "--use-extractors"} {
			if !strings.Contains(joined, required) {
				t.Errorf("missing %s", required)
			}
		}
		if args[len(args)-2] != "--" || args[len(args)-1] != "https://youtu.be/abcdefghijk" {
			t.Fatal("source was not a separate argument")
		}
		return []byte(`{"title":"公开作品","duration":42.5,"requested_formats":[{"width":1920,"height":1080,"filesize":400},{"filesize_approx":100}]}`), nil, nil
	}
	m, err := s.Resolve(context.Background(), "https://youtu.be/abcdefghijk", "compat")
	if err != nil || m.Height != 1080 || m.EstimatedBytes != 500 {
		t.Fatalf("metadata %+v %v", m, err)
	}
	s.cfg.MaxFileBytes = 499
	_, err = s.Resolve(context.Background(), "https://youtu.be/abcdefghijk", "compat")
	requireError(t, err, 400)
	for _, payload := range []string{`{"_type":"playlist","entries":[{}]}`, `{"is_live":true}`, `{"has_drm":true}`, `{"availability":"premium_only"}`, `{"is_preview":true}`} {
		s.run = func(context.Context, string, []string, string, int64) ([]byte, []byte, error) {
			return []byte(payload), nil, nil
		}
		_, err = s.Resolve(context.Background(), "https://youtu.be/abcdefghijk", "quality")
		requireError(t, err, 400)
	}
}

func prepareDirect(s *Service, t *testing.T, fail bool) {
	s.client.Transport = roundTripFunc(func(r *http.Request) (*http.Response, error) {
		switch r.URL.Host {
		case "v.kuaishou.com":
			return responseFor(r, `<meta property="og:title" content="原视频"><video src="https://v.kwimgs.com/source.mp4"></video>`, "text/html"), nil
		case "v.kwimgs.com":
			return responseFor(r, "fake-media", "video/mp4"), nil
		default:
			t.Errorf("unexpected host %s", r.URL.Host)
			return nil, errors.New("unexpected host")
		}
	})
	s.run = func(ctx context.Context, _ string, args []string, dir string, _ int64) ([]byte, []byte, error) {
		if strings.Contains(strings.Join(args, " "), "-show_entries") {
			return []byte(`{"streams":[{"codec_type":"video","codec_name":"hevc","width":1920,"height":1080}]}`), nil, nil
		}
		if fail {
			return nil, nil, errors.New("ffmpeg unavailable")
		}
		if !strings.Contains(strings.Join(args, " "), "-vf scale=-2:480") {
			t.Errorf("speed limit not applied: %v", args)
		}
		if err := os.WriteFile(args[len(args)-1], []byte("converted-video"), 0600); err != nil {
			t.Fatal(err)
		}
		return nil, nil, nil
	}
}
func TestDownloadStagesValidatesAndReleasesResources(t *testing.T) {
	s := testService(t)
	prepareDirect(s, t, false)
	f, err := s.Download(context.Background(), "https://v.kuaishou.com/abc123", "speed")
	if err != nil {
		t.Fatal(err)
	}
	if f.Size != 15 {
		t.Fatalf("size %d", f.Size)
	}
	_, err = s.Download(context.Background(), "https://v.kuaishou.com/abc123", "speed")
	requireError(t, err, 429)
	entries, _ := os.ReadDir(s.cfg.TempDir)
	if len(entries) != 1 {
		t.Fatalf("staging dirs %v", entries)
	}
	if err = f.Close(); err != nil {
		t.Fatal(err)
	}
	_ = f.Close() // idempotent: no double semaphore release
	entries, _ = os.ReadDir(s.cfg.TempDir)
	if len(entries) != 0 {
		t.Fatal("temporary files retained after delivery")
	}
	f, err = s.Download(context.Background(), "https://v.kuaishou.com/abc123", "speed")
	if err != nil {
		t.Fatal("slot not released", err)
	}
	f.Close()
	prepareDirect(s, t, true)
	_, err = s.Download(context.Background(), "https://v.kuaishou.com/abc123", "speed")
	if err == nil {
		t.Fatal("failed ffmpeg accepted")
	}
	entries, _ = os.ReadDir(s.cfg.TempDir)
	if len(entries) != 0 || len(s.downloads) != 0 {
		t.Fatal("failure leaked files or slot")
	}
}

func TestCopyMediaEnforcesUnknownSizeLimit(t *testing.T) {
	s := testService(t)
	s.client.Transport = roundTripFunc(func(r *http.Request) (*http.Response, error) {
		v := responseFor(r, strings.Repeat("x", 101), "video/mp4")
		v.ContentLength = -1
		return v, nil
	})
	err := s.copyMedia(context.Background(), "https://v.kwimgs.com/source.mp4", "https://v.kuaishou.com/abc", filepath.Join(t.TempDir(), "video.mp4"), 100)
	requireError(t, err, 413)
}

func TestProxyRejectsPrivateTargetsAndRequiresCapability(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	address, closeProxy, err := publicProxy(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer closeProxy()
	u, _ := url.Parse(address)
	client := &http.Client{Transport: &http.Transport{Proxy: http.ProxyURL(u)}, Timeout: time.Second}
	for _, target := range []string{"http://127.0.0.1/", "https://127.0.0.1/", "http://169.254.169.254/latest/meta-data/", "https://[::1]/"} {
		resp, err := client.Get(target)
		if err == nil {
			resp.Body.Close()
			if resp.StatusCode < 400 {
				t.Fatalf("unsafe target accepted: %s", target)
			}
		}
	}
	noAuth := *u
	noAuth.User = nil
	client.Transport = &http.Transport{Proxy: http.ProxyURL(&noAuth)}
	resp, err := client.Get("http://example.com")
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != 407 {
		t.Fatalf("unauthenticated proxy accepted: %d", resp.StatusCode)
	}
	closeProxy()
	if conn, err := net.DialTimeout("tcp", u.Host, time.Second); err == nil {
		conn.Close()
		t.Fatal("proxy listener leaked")
	}
}

func TestResolveCancellationAndConcurrentLimit(t *testing.T) {
	s := testService(t)
	started := make(chan struct{})
	s.run = func(ctx context.Context, _ string, _ []string, _ string, _ int64) ([]byte, []byte, error) {
		close(started)
		<-ctx.Done()
		return nil, nil, ctx.Err()
	}
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() { _, err := s.Resolve(ctx, "https://youtu.be/abcdefghijk", "compat"); done <- err }()
	<-started
	_, err := s.Resolve(context.Background(), "https://youtu.be/abcdefghijk", "compat")
	requireError(t, err, 429)
	cancel()
	requireError(t, <-done, 504)
	if len(s.resolves) != 0 {
		t.Fatal("resolve slot leaked")
	}
}

func TestConfigLimitsAndMissingRuntime(t *testing.T) {
	s := New(config.VideoDownloaderConfig{Enabled: true, Command: "/missing/yt-dlp", MaxFileBytes: 9 << 30, MaxConcurrent: 900})
	if s.Ready() || s.MaxBytes() != 512<<20 || cap(s.downloads) != 2 {
		t.Fatal("bad capability defaults")
	}
	_, err := s.Resolve(context.Background(), "https://youtu.be/abcdefghijk", "compat")
	requireError(t, err, 503)
}

func TestUnknownOrAudioOnlyOutputIsRejected(t *testing.T) {
	s := testService(t)
	dir := t.TempDir()
	file := filepath.Join(dir, "output.mp4")
	os.WriteFile(file, []byte("not-video"), 0600)
	s.run = func(context.Context, string, []string, string, int64) ([]byte, []byte, error) {
		b, _ := json.Marshal(map[string]any{"streams": []any{map[string]any{"codec_type": "audio"}}})
		return b, nil, nil
	}
	if err := s.inspectOutput(context.Background(), file, dir); err == nil {
		t.Fatal("audio-only output accepted")
	}
}

func TestMissingFragmentFailsDownloadAndReleasesStaging(t *testing.T) {
	s := testService(t)
	s.run = func(_ context.Context, _ string, args []string, _ string, _ int64) ([]byte, []byte, error) {
		joined := strings.Join(args, " ")
		if strings.Contains(joined, "--dump-single-json") {
			return []byte(`{"title":"segmented video","duration":12,"height":480,"width":640}`), nil, nil
		}
		if !strings.Contains(joined, "--abort-on-unavailable-fragments") || !strings.Contains(joined, "--fragment-retries 2") {
			t.Error("missing fragment must not be silently skipped")
		}
		return nil, []byte("ERROR: fragment 2 not found, unable to continue"), errors.New("extractor failed")
	}
	f, err := s.Download(context.Background(), "https://youtu.be/abcdefghijk", "compat")
	requireError(t, err, 502)
	if f != nil || !strings.Contains(err.Error(), "片段下载失败") {
		t.Fatal("partial file was returned or failure message lost", err)
	}
	entries, _ := os.ReadDir(s.cfg.TempDir)
	if len(entries) != 0 || len(s.downloads) != 0 {
		t.Fatal("fragment failure leaked files or slot")
	}
}
