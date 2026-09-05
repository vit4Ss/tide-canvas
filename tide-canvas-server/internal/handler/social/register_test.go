package social

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync"
	"testing"

	"github.com/gin-gonic/gin"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"

	"tidecanvas/internal/middleware"
	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/idgen"
	"tidecanvas/internal/pkg/response"
)

func TestParseSourceURLSupportsInitialPlatforms(t *testing.T) {
	tests := map[string]platform{
		"https://www.douyin.com/video/1":          platformDouyin,
		"https://b23.tv/abc":                      platformBilibili,
		"https://www.xiaohongshu.com/explore/abc": platformXiaohongshu,
		"https://youtu.be/dQw4w9WgXcQ":            platformYouTube,
		"https://www.tiktok.com/@creator/video/1": platformTikTok,
		"https://v.kuaishou.com/example":          platformKuaishou,
	}
	for raw, want := range tests {
		_, got, err := parseSourceURL(raw)
		if err != nil || got != want {
			t.Errorf("parseSourceURL(%q) = %q, %v; want %q", raw, got, err, want)
		}
	}
	if _, _, err := parseSourceURL("https://example.com/video/1"); err == nil {
		t.Fatal("unsupported host was accepted")
	}
	if _, _, err := parseSourceURL("javascript:alert(1)"); err == nil {
		t.Fatal("non-http URL was accepted")
	}
	if _, _, err := parseSourceURL("https://user:pass@www.douyin.com/video/1"); err == nil {
		t.Fatal("URL credentials were accepted")
	}
	parsed, got, err := parseSourceURL("复制打开抖音 https://v.douyin.com/example/ 看视频")
	if err != nil || got != platformDouyin || parsed.String() != "https://v.douyin.com/example/" {
		t.Fatalf("share text parsing = %v, %q, %v", parsed, got, err)
	}
	parsed, _, _ = parseSourceURL("https://www.douyin.com/video/1#comments")
	if parsed.Fragment != "" {
		t.Fatalf("source fragment was not stripped: %s", parsed.String())
	}
}

func TestTikHubClientRejectsCrossHostRedirect(t *testing.T) {
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"code":200,"data":{}}`))
	}))
	defer target.Close()
	source := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, target.URL, http.StatusFound)
	}))
	defer source.Close()
	_, err := newTikHubHTTPClient().Get(source.URL)
	if err == nil || !strings.Contains(err.Error(), "cross-host") {
		t.Fatalf("cross-host redirect error = %v", err)
	}
}

func TestNormalizeNestedDouyinWork(t *testing.T) {
	input := map[string]any{"aweme_detail": map[string]any{
		"aweme_id": "123", "desc": "三秒开场测试", "create_time": float64(1700000000),
		"video": map[string]any{
			"play_addr": map[string]any{"url_list": []any{"https://cdn.example/video.mp4"}},
			"cover":     map[string]any{"url_list": []any{"https://cdn.example/cover.jpg"}},
		},
		"statistics": map[string]any{"play_count": float64(1200), "digg_count": float64(88), "comment_count": float64(6)},
	}}
	got := normalizeWork(input, "https://www.douyin.com/video/123")
	if got.ID != "123" || got.MediaURL != "https://cdn.example/video.mp4" || got.CoverURL != "https://cdn.example/cover.jpg" {
		t.Fatalf("unexpected normalized work: %+v", got)
	}
	if got.Stats.Play != "1200" || got.Stats.Like != "88" || got.Stats.Comment != "6" {
		t.Fatalf("unexpected stats: %+v", got.Stats)
	}
}

func TestNormalizeBilibiliArchiveListFields(t *testing.T) {
	input := map[string]any{
		"bvid": "BV1Example", "title": "Bilibili sample", "description": "sample description",
		"pic": "https://i.example/bilibili-cover.jpg", "created": float64(1788515520), "length": "12:34",
		"play": float64(128000), "review": float64(326), "favorites": float64(892),
	}
	got := normalizeWork(input, "")
	if got.ID != "BV1Example" || got.MediaType != "video" || got.CoverURL != "https://i.example/bilibili-cover.jpg" || got.PageURL != "https://www.bilibili.com/video/BV1Example" {
		t.Fatalf("unexpected Bilibili identity fields: %+v", got)
	}
	if got.PublishedAt != "1788515520" || got.Duration != "12:34" {
		t.Fatalf("unexpected Bilibili timing fields: %+v", got)
	}
	if got.Stats.Play != "128000" || got.Stats.Comment != "326" || got.Stats.Favorite != "892" {
		t.Fatalf("unexpected Bilibili stats: %+v", got.Stats)
	}
}

func TestNormalizeImagePostKeepsOrderedCarouselWithoutBorrowingAuthorAvatar(t *testing.T) {
	input := map[string]any{"note_card": map[string]any{
		"note_id": "note-1", "title": "轮播作品", "type": "normal",
		"cover": map[string]any{"url": "https://cdn.example/cover-thumb.jpg"},
		"image_list": []any{
			map[string]any{"url_default": "https://cdn.example/page-1.jpg"},
			map[string]any{"url_default": "https://cdn.example/page-2.jpg"},
		},
		"user": map[string]any{"avatar": "https://cdn.example/avatar.jpg"},
	}}
	got := normalizeWork(input, "https://www.xiaohongshu.com/explore/note-1")
	if len(got.ImageURLs) != 2 || got.ImageURLs[0] != "https://cdn.example/page-1.jpg" || got.ImageURLs[1] != "https://cdn.example/page-2.jpg" {
		t.Fatalf("carousel image order was not preserved: %+v", got.ImageURLs)
	}
	if got.CoverURL != "https://cdn.example/cover-thumb.jpg" {
		t.Fatalf("cover changed unexpectedly: %q", got.CoverURL)
	}
	for _, imageURL := range got.ImageURLs {
		if strings.Contains(imageURL, "avatar") {
			t.Fatalf("author avatar leaked into carousel: %+v", got.ImageURLs)
		}
	}
}

func TestNormalizeTikTokPluralAwemeDetails(t *testing.T) {
	input := map[string]any{"aweme_details": []any{map[string]any{
		"aweme_id": "7339393672959757570", "desc": "TikTok sample",
		"video": map[string]any{
			"duration":  float64(32900),
			"play_addr": map[string]any{"url_list": []any{"https://cdn.example/tiktok-play", "https://backup.example/tiktok-play"}},
			"cover":     map[string]any{"url_list": []any{"https://cdn.example/tiktok-cover.webp"}},
		},
		"author":     map[string]any{"unique_id": "creator", "nickname": "Creator"},
		"statistics": map[string]any{"play_count": float64(321), "digg_count": float64(12)},
	}}}
	work := normalizeWork(input, "https://www.tiktok.com/@creator/video/7339393672959757570")
	if work.ID != "7339393672959757570" || work.Title != "TikTok sample" || work.MediaURL != "https://cdn.example/tiktok-play" || len(work.MediaURLs) != 2 || work.MediaURLs[1] != "https://backup.example/tiktok-play" || work.Duration != "00:33" {
		t.Fatalf("unexpected TikTok work: %+v", work)
	}
	profile := normalizeProfile(input, nil, false)
	if profile == nil || profile.Name != "Creator" || profile.Handle != "creator" {
		t.Fatalf("unexpected TikTok profile: %+v", profile)
	}
}

func TestNormalizeKuaishouPhotoDoesNotUseSoundtrackIdentity(t *testing.T) {
	input := map[string]any{
		"photo": map[string]any{
			"photoId": "5213479667346575810", "caption": "外星鸭脖", "duration": float64(58750),
			"mainMvUrls": []any{map[string]any{"url": "https://cdn.example/kuaishou.mp4"}},
			"coverUrls":  []any{map[string]any{"url": "https://cdn.example/kuaishou.jpg"}},
			"userName":   "权少", "userEid": "3xz63mn6fngqtiq",
			"soundTrack": map[string]any{"id": "music-id", "name": "不要误取这个配乐名", "play_url": "https://cdn.example/audio.m4a"},
			"viewCount":  float64(1837925), "likeCount": float64(97950), "commentCount": float64(3247),
		},
		"counts": map[string]any{"fanCount": float64(4173288), "followCount": float64(213), "photoCount": float64(257)},
	}
	work := normalizeWork(input, "https://v.kuaishou.com/example")
	if work.Title != "外星鸭脖" || work.MediaURL != "https://cdn.example/kuaishou.mp4" || work.CoverURL != "https://cdn.example/kuaishou.jpg" || work.Duration != "00:59" {
		t.Fatalf("unexpected Kuaishou work: %+v", work)
	}
	profile := normalizeProfile(input, nil, false)
	if profile == nil || profile.Name != "权少" || profile.Handle != "" || profile.ID != "3xz63mn6fngqtiq" || profile.Followers != "4173288" || profile.Works != "257" {
		t.Fatalf("unexpected Kuaishou profile: %+v", profile)
	}
}

func TestProfileAndWorkIDsDoNotFallBackToNestedMusicOrWorkIDs(t *testing.T) {
	works := map[string]any{"aweme_list": []any{map[string]any{
		"aweme_id": "work-id", "desc": "sample", "description": "https://twitch.example/not-a-profile-bio", "likes": float64(9999), "author": map[string]any{"nickname": "Creator"},
	}}}
	profile := normalizeProfile(nil, works, true)
	if profile == nil || profile.Name != "Creator" || profile.ID != "" || profile.Bio != "" || profile.Likes != "" {
		t.Fatalf("profile incorrectly borrowed a work id: %+v", profile)
	}
	work := normalizeWork(map[string]any{"title": "sample", "music": map[string]any{"id": "music-id"}}, "")
	if work.ID != "" {
		t.Fatalf("work incorrectly borrowed nested music id: %+v", work)
	}
}

func TestAccountProfileAllowsDirectRootNameWithoutContentFalsePositive(t *testing.T) {
	direct := map[string]any{"mid": "123", "name": "Bilibili Creator"}
	profile := normalizeProfile([]any{direct, map[string]any{"follower": float64(42)}}, nil, true)
	if profile == nil || profile.ID != "123" || profile.Name != "Bilibili Creator" || profile.Followers != "42" {
		t.Fatalf("direct account profile = %+v", profile)
	}
	if contentProfile := normalizeProfile(map[string]any{"id": "work-id", "name": "soundtrack"}, nil, false); contentProfile != nil {
		t.Fatalf("content metadata became a false creator profile: %+v", contentProfile)
	}
	works := map[string]any{"vlist": []any{map[string]any{"bvid": "BV1Example", "author": "Fallback Bilibili Creator"}}}
	if fallback := normalizeProfile(nil, works, true); fallback == nil || fallback.Name != "Fallback Bilibili Creator" {
		t.Fatalf("scalar work author did not supplement a missing account name: %+v", fallback)
	}
}

func TestYouTubeMergedStreamPrefersItag18WithAudio(t *testing.T) {
	input := map[string]any{
		"formats": []any{
			map[string]any{"itag": float64(22), "height": float64(720), "mime_type": "video/mp4", "url": "https://cdn.example/720.mp4"},
			map[string]any{"itag": float64(18), "height": float64(360), "mime_type": "video/mp4", "url": "https://cdn.example/360.mp4"},
		},
		"adaptive_formats": []any{
			map[string]any{"itag": float64(137), "height": float64(1080), "mime_type": "video/mp4", "url": "https://cdn.example/video-only.mp4"},
		},
	}
	if got := findYouTubeMergedMediaURL(input); got != "https://cdn.example/360.mp4" {
		t.Fatalf("merged YouTube stream = %q", got)
	}
}

func TestPlatformIdentifierParsing(t *testing.T) {
	douyin, _, _ := parseSourceURL("https://www.douyin.com/user/MS4w.example")
	if got := pathSegmentAfter(douyin, "user"); got != "MS4w.example" {
		t.Fatalf("douyin id = %q", got)
	}
	bili, _, _ := parseSourceURL("https://space.bilibili.com/178360345")
	if got := bilibiliUserID(bili); got != "178360345" {
		t.Fatalf("bilibili id = %q", got)
	}
	youtube, _, _ := parseSourceURL("https://www.youtube.com/shorts/dQw4w9WgXcQ")
	if got := youtubeVideoID(youtube); got != "dQw4w9WgXcQ" {
		t.Fatalf("youtube id = %q", got)
	}
	tiktok, _, _ := parseSourceURL("https://www.tiktok.com/@openai/video/123")
	if got := tiktokUniqueID(tiktok); got != "openai" {
		t.Fatalf("tiktok id = %q", got)
	}
}

func TestNormalizeDurationSupportsPlatformSecondsAndMilliseconds(t *testing.T) {
	tests := []struct {
		raw          string
		milliseconds bool
		want         string
	}{
		{"65", false, "01:05"},
		{"1200", false, "20:00"},
		{"32900", true, "00:33"},
		{"1:23", true, "1:23"},
	}
	for _, test := range tests {
		if got := normalizeDuration(test.raw, test.milliseconds); got != test.want {
			t.Errorf("normalizeDuration(%q, %v) = %q, want %q", test.raw, test.milliseconds, got, test.want)
		}
	}
}

func TestNormalizedMediaURLsRejectLocalNetworkTargets(t *testing.T) {
	for _, raw := range []string{"http://127.0.0.1/private.mp4", "http://localhost/private.mp4", "http://192.168.1.2/private.mp4", "http://[::1]/private.mp4", "http://100.64.0.1/private.mp4", "http://198.18.0.1/private.mp4", "http://224.1.2.3/private.mp4"} {
		if got := validHTTPURL(raw); got != "" {
			t.Errorf("validHTTPURL(%q) = %q, want empty", raw, got)
		}
	}
	if got := validHTTPURL("https://cdn.example/video.mp4"); got == "" {
		t.Fatal("public HTTPS media URL was rejected")
	}
}

func TestArchiveableMediaURLsRejectStreamingManifests(t *testing.T) {
	for _, raw := range []string{
		"https://cdn.example/live/master.m3u8",
		"https://cdn.example/video?format=m3u8",
		"https://cdn.example/manifest.mpd",
		"https://cdn.example/video?mime_type=application%2Fx-mpegURL",
		"https://cdn.example/soundtrack.m4a",
		"https://cdn.example/play?mime_type=audio_mpeg",
	} {
		if got := archiveableMediaURL(raw); got != "" {
			t.Errorf("archiveableMediaURL(%q) = %q, want empty", raw, got)
		}
	}
	if got := archiveableMediaURL("https://cdn.example/video?mime_type=video_mp4"); got == "" {
		t.Fatal("direct MP4 media URL was rejected")
	}
}

func TestVideoFallbackRequiresARealVideoPathOrMime(t *testing.T) {
	if got := findVideoLikeURL("https://cdn.example/cover.jpg?source=video.mp4", 0); got != "" {
		t.Fatalf("image URL with video-looking query was accepted: %q", got)
	}
	if got := findVideoLikeURL("https://cdn.example/result.webm?token=1", 0); got == "" {
		t.Fatal("WebM video path was rejected")
	}
	withMime := map[string]any{"mime_type": "video/mp4", "url": "https://cdn.example/playback?id=1"}
	if got := findVideoLikeURL(withMime, 0); got == "" {
		t.Fatal("explicit video MIME URL without extension was rejected")
	}
}

func TestTikHubGetKeepsCredentialServerSideAndUnwrapsData(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer secret-token" {
			t.Errorf("authorization = %q", r.Header.Get("Authorization"))
		}
		if r.URL.Path != "/api/v1/test" || r.URL.Query().Get("share_url") != "https://www.douyin.com/video/1" {
			t.Errorf("unexpected upstream request: %s", r.URL.String())
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"code":200,"message":"ok","data":{"aweme_id":"1"}}`))
	}))
	defer server.Close()
	h := &handler{httpcli: server.Client()}
	data, err := h.tikhubGet(context.Background(), settings{baseURL: server.URL, apiKey: "secret-token"}, "/api/v1/test", url.Values{"share_url": {"https://www.douyin.com/video/1"}})
	if err != nil || firstString(data, "aweme_id") != "1" {
		t.Fatalf("tikhubGet() = %#v, %v", data, err)
	}
}

func TestTikHubGetPreservesLargeNumericPlatformIDs(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"code":200,"data":{"photoId":5213479667346575810}}`))
	}))
	defer server.Close()
	h := &handler{httpcli: server.Client()}
	data, err := h.tikhubGet(context.Background(), settings{baseURL: server.URL, apiKey: "secret"}, "/api/v1/test", nil)
	if err != nil {
		t.Fatal(err)
	}
	if got := firstString(data, "photoId"); got != "5213479667346575810" {
		t.Fatalf("large platform id = %q", got)
	}
}

func TestTikHubGetFormatsEmptyAndNestedPlatformErrors(t *testing.T) {
	tests := []struct {
		body string
		want string
	}{
		{`{"code":200,"message_zh":"请求成功，本次请求将被计费。","data":null}`, "平台没有返回内容"},
		{`{"code":200,"data":{"status_code":4,"status_msg":"作品不可见"}}`, "作品不可见"},
		{`{"code":200,"data":{"code":-400,"message":"账号不存在"}}`, "账号不存在"},
		{`{"code":200,"data":{"success":false}}`, "平台返回失败状态"},
	}
	for _, test := range tests {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(test.body))
		}))
		h := &handler{httpcli: server.Client()}
		_, err := h.tikhubGet(context.Background(), settings{baseURL: server.URL, apiKey: "secret"}, "/api/v1/test", nil)
		server.Close()
		if err == nil || !strings.Contains(err.Error(), test.want) {
			t.Errorf("tikhubGet error = %v, want %q", err, test.want)
		}
	}
}

func TestTikHubGetFormatsNonJSONHTTPFailuresByStatus(t *testing.T) {
	for status, want := range map[int]string{
		http.StatusUnauthorized:    "凭证无效",
		http.StatusPaymentRequired: "额度不足",
		http.StatusTooManyRequests: "请求过于频繁",
		http.StatusBadGateway:      "服务暂时不可用",
	} {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			w.WriteHeader(status)
			_, _ = w.Write([]byte("plain text failure"))
		}))
		h := &handler{httpcli: server.Client()}
		_, err := h.tikhubGet(context.Background(), settings{baseURL: server.URL, apiKey: "secret"}, "/api/v1/test", nil)
		server.Close()
		if err == nil || !strings.Contains(err.Error(), want) {
			t.Errorf("HTTP %d error = %v, want %q", status, err, want)
		}
	}
}

func TestContentInspectRequestMatrix(t *testing.T) {
	tests := []struct {
		name     string
		platform platform
		source   string
		requests []string
	}{
		{"douyin", platformDouyin, "https://www.douyin.com/video/1", []string{"/api/v1/douyin/app/v3/fetch_one_video?aweme_id=1"}},
		{"bilibili", platformBilibili, "https://www.bilibili.com/video/BV1xx", []string{"/api/v1/bilibili/web/fetch_one_video_v3?url=https%3A%2F%2Fwww.bilibili.com%2Fvideo%2FBV1xx"}},
		{"xiaohongshu", platformXiaohongshu, "https://www.xiaohongshu.com/explore/1", []string{"/api/v1/xiaohongshu/app_v2/get_image_note_detail?share_text=https%3A%2F%2Fwww.xiaohongshu.com%2Fexplore%2F1"}},
		{"youtube", platformYouTube, "https://www.youtube.com/watch?v=dQw4w9WgXcQ", []string{
			"/api/v1/youtube/web_v2/get_video_info_v2?need_format=true&video_id=dQw4w9WgXcQ",
			"/api/v1/youtube/web_v2/get_video_streams_v2?video_id=dQw4w9WgXcQ&video_url=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3DdQw4w9WgXcQ",
		}},
		{"tiktok", platformTikTok, "https://www.tiktok.com/@creator/video/1", []string{"/api/v1/tiktok/app/v3/fetch_one_video_by_share_url_v2?share_url=https%3A%2F%2Fwww.tiktok.com%2F%40creator%2Fvideo%2F1"}},
		{"kuaishou", platformKuaishou, "https://www.kuaishou.com/short-video/1", []string{"/api/v1/kuaishou/app/fetch_one_video_by_url?share_text=https%3A%2F%2Fwww.kuaishou.com%2Fshort-video%2F1"}},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			var mu sync.Mutex
			received := []string{}
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				mu.Lock()
				received = append(received, r.URL.Path+"?"+r.URL.Query().Encode())
				mu.Unlock()
				w.Header().Set("Content-Type", "application/json")
				if strings.Contains(r.URL.Path, "get_video_streams_v2") {
					_, _ = w.Write([]byte(`{"code":200,"data":{"formats":[{"itag":18,"height":360,"mime_type":"video/mp4","url":"https://cdn.example/youtube.mp4"}]}}`))
					return
				}
				if strings.Contains(r.URL.Path, "/bilibili/") {
					_, _ = w.Write([]byte(`{"code":200,"data":{"bvid":"BV1xx","title":"sample","media_url":"https://cdn.example/video.mp4","owner":{"name":"Creator"},"stat":{"view":10,"like":0,"reply":0,"share":0,"favorite":0}}}`))
					return
				}
				if strings.Contains(r.URL.Path, "/douyin/") {
					_, _ = w.Write([]byte(`{"code":200,"data":{"aweme_detail":{"aweme_id":"1","desc":"sample","video":{"play_addr":{"url_list":["https://cdn.example/video.mp4"]}},"author":{"nickname":"Creator"}}}}`))
					return
				}
				_, _ = w.Write([]byte(`{"code":200,"data":{"id":"1","title":"sample","cover":"https://cdn.example/cover.jpg","media_url":"https://cdn.example/video.mp4","user":{"name":"Creator"}}}`))
			}))
			defer server.Close()
			source, err := url.Parse(test.source)
			if err != nil {
				t.Fatal(err)
			}
			h := &handler{httpcli: server.Client()}
			result, err := h.inspectContent(context.Background(), settings{baseURL: server.URL, apiKey: "secret"}, test.platform, source)
			if err != nil || result == nil || result.Content == nil || !workHasData(*result.Content) {
				t.Fatalf("inspectContent() = %#v, %v", result, err)
			}
			mu.Lock()
			defer mu.Unlock()
			if len(received) != len(test.requests) {
				t.Fatalf("requests = %#v, want %#v", received, test.requests)
			}
			for _, want := range test.requests {
				found := false
				for _, got := range received {
					if got == want {
						found = true
						break
					}
				}
				if !found {
					t.Errorf("missing request %q in %#v", want, received)
				}
			}
		})
	}
}

func TestAccountInspectRequestMatrix(t *testing.T) {
	tests := []struct {
		name     string
		platform platform
		source   string
		requests []string
	}{
		{"douyin", platformDouyin, "https://www.douyin.com/user/MS4wLjABTest", []string{
			"/api/v1/douyin/app/v3/handler_user_profile?sec_user_id=MS4wLjABTest",
			"/api/v1/douyin/app/v3/fetch_user_post_videos?count=12&max_cursor=0&sec_user_id=MS4wLjABTest&sort_type=0",
		}},
		{"bilibili", platformBilibili, "https://space.bilibili.com/123", []string{
			"/api/v1/bilibili/web/fetch_user_profile?uid=123",
			"/api/v1/bilibili/web/fetch_user_post_videos?order=pubdate&pn=1&ps=12&uid=123",
			"/api/v1/bilibili/web/fetch_user_relation_stat?uid=123",
			"/api/v1/bilibili/web/fetch_user_up_stat?uid=123",
			"/api/v1/bilibili/web/fetch_one_video?bv_id=BV1114y1X7TA",
		}},
		{"xiaohongshu", platformXiaohongshu, "https://www.xiaohongshu.com/user/profile/abc", []string{
			"/api/v1/xiaohongshu/app_v2/get_user_info?share_text=https%3A%2F%2Fwww.xiaohongshu.com%2Fuser%2Fprofile%2Fabc",
			"/api/v1/xiaohongshu/app_v2/get_user_posted_notes?share_text=https%3A%2F%2Fwww.xiaohongshu.com%2Fuser%2Fprofile%2Fabc",
			"/api/v1/xiaohongshu/app_v2/get_image_note_detail?note_id=v1",
		}},
		{"youtube", platformYouTube, "https://www.youtube.com/channel/UC123456", []string{
			"/api/v1/youtube/web/get_channel_info?channel_id=UC123456",
			"/api/v1/youtube/web_v2/get_channel_videos?channel_id=UC123456&language_code=zh-CN&need_format=true",
		}},
		{"tiktok", platformTikTok, "https://www.tiktok.com/@creator", []string{
			"/api/v1/tiktok/app/v3/handler_user_profile?unique_id=creator",
			"/api/v1/tiktok/app/v3/fetch_user_post_videos?count=12&max_cursor=0&sort_type=0&unique_id=creator",
		}},
		{"kuaishou", platformKuaishou, "https://www.kuaishou.com/profile/eid", []string{
			"/api/v1/kuaishou/app/fetch_one_user_v2?user_id=eid",
			"/api/v1/kuaishou/app/fetch_user_post_v2?user_id=eid",
		}},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			var mu sync.Mutex
			received := []string{}
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				mu.Lock()
				received = append(received, r.URL.Path+"?"+r.URL.Query().Encode())
				mu.Unlock()
				w.Header().Set("Content-Type", "application/json")
				if strings.HasSuffix(r.URL.Path, "/fetch_one_video") && strings.Contains(r.URL.Path, "/bilibili/") {
					_, _ = w.Write([]byte(`{"code":200,"data":{"bvid":"BV1114y1X7TA","title":"work","stat":{"view":100,"like":12,"reply":2,"coin":1,"danmaku":0,"share":3,"favorite":4}}}`))
					return
				}
				if strings.HasSuffix(r.URL.Path, "/get_image_note_detail") {
					_, _ = w.Write([]byte(`{"code":200,"data":{"note_id":"v1","title":"work","type":"normal","interact_info":{"liked_count":12,"comment_count":2,"collected_count":3,"shared_count":0}}}`))
					return
				}
				if strings.Contains(r.URL.Path, "/bilibili/") {
					_, _ = w.Write([]byte(`{"code":200,"data":{"user":{"mid":"123","name":"Creator"},"list":{"vlist":[{"bvid":"BV1114y1X7TA","title":"work","stat":{"like":12,"reply":2,"coin":1}}]}}}`))
					return
				}
				_, _ = w.Write([]byte(`{"code":200,"data":{"user":{"user_id":"u1","nickname":"Creator"},"aweme_list":[{"aweme_id":"v1","desc":"work","statistics":{"digg_count":12,"comment_count":2},"media_url":"https://cdn.example/video.mp4"}]}}`))
			}))
			defer server.Close()
			source, err := url.Parse(test.source)
			if err != nil {
				t.Fatal(err)
			}
			h := &handler{httpcli: server.Client()}
			result, err := h.inspectAccount(context.Background(), settings{baseURL: server.URL, apiKey: "secret"}, test.platform, source)
			if err != nil || result == nil || result.Profile == nil || len(result.Works) != 1 {
				t.Fatalf("inspectAccount() = %#v, %v", result, err)
			}
			mu.Lock()
			defer mu.Unlock()
			if len(received) != len(test.requests) {
				t.Fatalf("requests = %#v, want %#v", received, test.requests)
			}
			for _, want := range test.requests {
				found := false
				for _, got := range received {
					if got == want {
						found = true
						break
					}
				}
				if !found {
					t.Errorf("missing request %q in %#v", want, received)
				}
			}
		})
	}
}

func TestAccountInspectDegradesToWorkAuthorWhenProfileFails(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if strings.Contains(r.URL.Path, "handler_user_profile") {
			w.WriteHeader(http.StatusBadGateway)
			_, _ = w.Write([]byte(`{"code":502,"message":"upstream unavailable","data":null}`))
			return
		}
		_, _ = w.Write([]byte(`{"code":200,"data":{"aweme_list":[{"aweme_id":"v1","desc":"work","author":{"nickname":"Fallback Creator"}}]}}`))
	}))
	defer server.Close()
	source, _ := url.Parse("https://www.douyin.com/user/MS4wLjABTest")
	h := &handler{httpcli: server.Client()}
	result, err := h.inspectAccount(context.Background(), settings{baseURL: server.URL, apiKey: "secret"}, platformDouyin, source)
	if err != nil || result == nil || result.Profile == nil || result.Profile.ID != "MS4wLjABTest" || result.Profile.Name != "Fallback Creator" || len(result.Works) != 1 {
		t.Fatalf("degraded account result = %#v, %v", result, err)
	}
	if len(result.Warnings) == 0 || !strings.Contains(result.Warnings[0], "账号资料") {
		t.Fatalf("missing partial-failure warning: %#v", result.Warnings)
	}
}

func TestYouTubeContentDegradesWhenMetadataFails(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if strings.Contains(r.URL.Path, "get_video_info_v2") {
			w.WriteHeader(http.StatusBadGateway)
			_, _ = w.Write([]byte(`{"code":502,"message":"upstream unavailable","data":null}`))
			return
		}
		_, _ = w.Write([]byte(`{"code":200,"data":{"title":"Stream title","formats":[{"itag":18,"height":360,"mime_type":"video/mp4","url":"https://cdn.example/youtube.mp4"}]}}`))
	}))
	defer server.Close()
	source, _ := url.Parse("https://www.youtube.com/watch?v=dQw4w9WgXcQ")
	h := &handler{httpcli: server.Client()}
	result, err := h.inspectContent(context.Background(), settings{baseURL: server.URL, apiKey: "secret"}, platformYouTube, source)
	if err != nil || result == nil || result.Content == nil || result.Content.MediaURL != "https://cdn.example/youtube.mp4" {
		t.Fatalf("degraded YouTube result = %#v, %v", result, err)
	}
	if len(result.Warnings) == 0 || !strings.Contains(result.Warnings[0], "基础信息") {
		t.Fatalf("missing YouTube warning: %#v", result.Warnings)
	}
}

func TestInspectHTTPHandlerLoadsServerCredentialWithoutExposingIt(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.SysConfig{}, &model.SocialActivityRecord{}); err != nil {
		t.Fatal(err)
	}
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer test-key" {
			t.Errorf("upstream authorization = %q", r.Header.Get("Authorization"))
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"code":200,"data":{"aweme_id":"1","desc":"sample","video":{"play_addr":{"url_list":["https://cdn.example/video.mp4"]}}}}`))
	}))
	defer upstream.Close()
	configs := []model.SysConfig{
		{ConfigKey: model.ConfigKeySocialTikHubEnabled, ConfigValue: "1"},
		{ConfigKey: model.ConfigKeySocialTikHubBaseURL, ConfigValue: upstream.URL},
		{ConfigKey: model.ConfigKeySocialTikHubAPIKey, ConfigValue: "test-key"},
	}
	if err := db.Create(&configs).Error; err != nil {
		t.Fatal(err)
	}
	h := &handler{db: db, httpcli: upstream.Client()}
	router := gin.New()
	router.POST("/inspect", func(c *gin.Context) {
		c.Set(middleware.CtxUserID, idgen.ID(7001))
		c.Next()
	}, h.inspect)
	body := []byte(`{"url":"https://www.douyin.com/video/1","kind":"content"}`)
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/inspect", bytes.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	router.ServeHTTP(recorder, request)
	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d body=%s", recorder.Code, recorder.Body.String())
	}
	if bytes.Contains(recorder.Body.Bytes(), []byte("test-key")) {
		t.Fatal("inspect response exposed the TikHub credential")
	}
	var result response.Result[inspectVO]
	if err := json.Unmarshal(recorder.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	if !result.Success || result.Data.Content == nil || result.Data.Content.ID != "1" {
		t.Fatalf("unexpected inspect response: %+v", result)
	}
	if result.Data.RecordID == 0 {
		t.Fatal("inspect response did not expose its activity record id")
	}
	var activity model.SocialActivityRecord
	if err := db.First(&activity, "user_id = ?", idgen.ID(7001)).Error; err != nil {
		t.Fatal(err)
	}
	if activity.ActivityType != model.SocialActivityAnalysis || activity.Platform != "douyin" || activity.Kind != "content" || activity.Status != model.SocialActivitySucceeded || activity.CompletedAt == nil || !json.Valid([]byte(activity.SnapshotJSON)) {
		t.Fatalf("unexpected analysis activity: %+v", activity)
	}
}

func TestInspectHTTPHandlerFailsClosedWithoutTikHubCredential(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.SysConfig{}); err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.SysConfig{ConfigKey: model.ConfigKeySocialTikHubEnabled, ConfigValue: "1"}).Error; err != nil {
		t.Fatal(err)
	}
	h := &handler{db: db, httpcli: newTikHubHTTPClient()}
	router := gin.New()
	router.POST("/inspect", h.inspect)
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/inspect", strings.NewReader(`{"url":"https://www.douyin.com/video/1","kind":"content"}`))
	request.Header.Set("Content-Type", "application/json")
	router.ServeHTTP(recorder, request)
	var result response.Result[any]
	if err := json.Unmarshal(recorder.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	if result.Success || result.Code != response.CodeToolDisabled || !strings.Contains(result.Message, "尚未配置") {
		t.Fatalf("unexpected missing-key response: %+v", result)
	}
}

func TestInspectHTTPHandlerRejectsOversizedJSONBeforeUpstream(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.SysConfig{}); err != nil {
		t.Fatal(err)
	}
	h := &handler{db: db, httpcli: newTikHubHTTPClient()}
	router := gin.New()
	router.POST("/inspect", h.inspect)
	payload := `{"url":"https://www.douyin.com/video/1","kind":"content","padding":"` + strings.Repeat("x", maxInspectBody) + `"}`
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/inspect", strings.NewReader(payload))
	request.Header.Set("Content-Type", "application/json")
	router.ServeHTTP(recorder, request)
	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("oversized body status = %d body=%s", recorder.Code, recorder.Body.String())
	}
}
