package social

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"sync"
	"testing"
)

const douyinTestSec = "MS4wLjABTest"
const douyinTestProfile = `{"code":200,"data":{"user":{"sec_uid":"MS4wLjABTest","uid":"12345","nickname":"作品作者","follower_count":456,"following_count":12,"total_favorited":789,"aweme_count":2}}}`
const douyinTestPosts = `{"code":200,"data":{"aweme_list":[{"aweme_id":"777","desc":"最近作品","author":{"sec_uid":"MS4wLjABTest","nickname":"作品作者"},"statistics":{"digg_count":3,"comment_count":2,"collect_count":1,"share_count":0}}]}}`
const douyinTestWork = `{"code":200,"data":{"aweme_detail":{"aweme_id":"7669082935156313379","desc":"入口作品","author":{"sec_uid":"MS4wLjABTest","uid":"12345","nickname":"作品作者"}}}}`

// All network assertions below use an isolated upstream. Demo fixtures retain
// public counters/IDs but replace text/media URLs and omit unrelated metadata.
func douyinMock(t *testing.T, bodies map[string]string) (*handler, settings, func() []string) {
	t.Helper()
	var mu sync.Mutex
	calls := []string{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		calls = append(calls, r.URL.RequestURI())
		mu.Unlock()
		if r.Header.Get("Authorization") != "Bearer test-key" {
			t.Error("missing upstream authorization")
		}
		w.Header().Set("Content-Type", "application/json")
		body, ok := bodies[r.URL.Path]
		if !ok {
			t.Errorf("unexpected upstream request: %s", r.URL)
			w.WriteHeader(500)
			return
		}
		_, _ = w.Write([]byte(body))
	}))
	t.Cleanup(server.Close)
	return &handler{httpcli: server.Client()}, settings{baseURL: server.URL, apiKey: "test-key"}, func() []string { mu.Lock(); defer mu.Unlock(); return append([]string{}, calls...) }
}

func TestDouyinModalAccountUsesWorkAuthorBeforeProfileAPIs(t *testing.T) {
	h, cfg, calls := douyinMock(t, map[string]string{
		"/api/v1/douyin/app/v3/fetch_one_video":        douyinTestWork,
		"/api/v1/douyin/app/v3/handler_user_profile":   douyinTestProfile,
		"/api/v1/douyin/app/v3/fetch_user_post_videos": douyinTestPosts,
	})
	source, _ := url.Parse("https://www.douyin.com/jingxuan?modal_id=7669082935156313379")
	got, err := h.inspectAccount(context.Background(), cfg, platformDouyin, source)
	if err != nil {
		t.Fatal(err)
	}
	requests := calls()
	if len(requests) != 3 || requests[0] != "/api/v1/douyin/app/v3/fetch_one_video?aweme_id=7669082935156313379" {
		t.Fatalf("wrong requests: %v", requests)
	}
	for _, raw := range requests[1:] {
		u, _ := url.Parse(raw)
		if u.Query().Get("sec_user_id") != douyinTestSec {
			t.Fatalf("passed work ID as account ID: %s", raw)
		}
	}
	if got.Profile == nil || got.Profile.Name != "作品作者" || got.Profile.Followers != "456" || got.Profile.PageURL != "https://www.douyin.com/user/"+douyinTestSec || len(got.Works) != 1 || got.Works[0].ID != "777" || len(got.Warnings) != 1 {
		t.Fatalf("unexpected account: %+v", got)
	}
}

func TestDouyinAccountFallsBackFromEmptyAppResponses(t *testing.T) {
	h, cfg, calls := douyinMock(t, map[string]string{
		"/api/v1/douyin/app/v3/handler_user_profile":   `{"code":200,"data":{"status_code":0,"user":null}}`,
		"/api/v1/douyin/app/v3/fetch_user_post_videos": `{"code":200,"data":{"aweme_list":[]}}`,
		"/api/v1/douyin/web/handler_user_profile":      douyinTestProfile,
		"/api/v1/douyin/web/fetch_user_post_videos":    douyinTestPosts,
	})
	source, _ := url.Parse("https://www.douyin.com/user/" + douyinTestSec)
	got, err := h.inspectAccount(context.Background(), cfg, platformDouyin, source)
	if err != nil || got.Profile == nil || len(got.Works) != 1 || len(calls()) != 4 {
		t.Fatalf("got=%+v err=%v calls=%v", got, err, calls())
	}
}

func TestDouyinEmptyAccountIsValidWithoutRetryingPosts(t *testing.T) {
	h, cfg, calls := douyinMock(t, map[string]string{
		"/api/v1/douyin/app/v3/handler_user_profile":   `{"code":200,"data":{"user":{"sec_uid":"MS4wLjABTest","nickname":"新用户","aweme_count":0,"follower_count":0}}}`,
		"/api/v1/douyin/app/v3/fetch_user_post_videos": `{"code":200,"data":{"aweme_list":[],"has_more":0}}`,
	})
	source, _ := url.Parse("https://www.douyin.com/user/" + douyinTestSec)
	got, err := h.inspectAccount(context.Background(), cfg, platformDouyin, source)
	if err != nil || got.Profile == nil || got.Profile.Followers != "0" || len(got.Works) != 0 || len(calls()) != 2 || !strings.Contains(strings.Join(got.Warnings, " "), "没有公开作品") {
		t.Fatalf("got=%+v err=%v", got, err)
	}
}

func TestDouyinWorkRetriesDocumentedWebAPIAndExplainsFilterReason(t *testing.T) {
	for _, reason := range []string{"5", "8", "10"} {
		t.Run(reason, func(t *testing.T) {
			empty := `{"code":200,"data":{"aweme_detail":null,"filter_list":[{"reason":` + reason + `}]}}`
			h, cfg, calls := douyinMock(t, map[string]string{
				"/api/v1/douyin/app/v3/fetch_one_video": empty,
				"/api/v1/douyin/web/fetch_one_video":    empty,
			})
			source, _ := url.Parse("https://www.douyin.com/jingxuan?modal_id=7669082935156313379")
			_, err := h.inspectAccount(context.Background(), cfg, platformDouyin, source)
			if err == nil || len(calls()) != 2 || strings.Contains(err.Error(), "没有可识别的账号") {
				t.Fatalf("err=%v calls=%v", err, calls())
			}
		})
	}
	h, cfg, calls := douyinMock(t, map[string]string{
		"/api/v1/douyin/app/v3/fetch_one_video": `{"code":200,"data":{"aweme_detail":null}}`,
		"/api/v1/douyin/web/fetch_one_video":    douyinTestWork,
	})
	source, _ := url.Parse("https://www.douyin.com/jingxuan?modal_id=7669082935156313379")
	got, err := h.inspectContent(context.Background(), cfg, platformDouyin, source)
	if err != nil || got.Content == nil || got.Content.ID != "7669082935156313379" || got.Profile == nil || got.Profile.ID != douyinTestSec || len(calls()) != 2 {
		t.Fatalf("got=%+v err=%v", got, err)
	}
}

func TestDouyinShortShareDoesNotUseNumericUIDAsSecUserID(t *testing.T) {
	h, cfg, calls := douyinMock(t, map[string]string{
		"/api/v1/douyin/web/get_sec_user_id":                 `{"code":200,"data":{"user_id":"12345"}}`,
		"/api/v1/douyin/app/v3/fetch_one_video_by_share_url": douyinTestWork,
		"/api/v1/douyin/app/v3/handler_user_profile":         douyinTestProfile,
		"/api/v1/douyin/app/v3/fetch_user_post_videos":       douyinTestPosts,
	})
	source, _ := url.Parse("https://v.douyin.com/ExampleShare/")
	got, err := h.inspectAccount(context.Background(), cfg, platformDouyin, source)
	if err != nil || got.Profile == nil || got.Profile.ID != douyinTestSec || len(calls()) != 4 {
		t.Fatalf("got=%+v err=%v calls=%v", got, err, calls())
	}
	for _, call := range calls() {
		if strings.Contains(call, "sec_user_id=12345") {
			t.Fatal("UID passed as sec_user_id")
		}
	}
}

func TestDouyinLinkFormsPreserveWorkIDsAndRejectBareFeeds(t *testing.T) {
	for _, raw := range []string{
		"https://www.douyin.com/jingxuan?modal_id=7669082935156313379",
		"https://www.douyin.com/video/7669082935156313379",
		"https://www.douyin.com/note/7669082935156313379",
		"https://www.iesdouyin.com/share/video/7669082935156313379",
	} {
		u, _ := url.Parse(raw)
		if got := douyinWorkID(u); got != "7669082935156313379" {
			t.Fatalf("ID=%s for %s", got, raw)
		}
	}
	h, cfg, calls := douyinMock(t, map[string]string{})
	for _, raw := range []string{"https://www.douyin.com/jingxuan", "https://www.douyin.com/search/test", "https://www.douyin.com/jingxuan?modal_id=wrong"} {
		u, _ := url.Parse(raw)
		_, err := h.inspectAccount(context.Background(), cfg, platformDouyin, u)
		if err == nil || !strings.Contains(err.Error(), "没有具体作品或账号") {
			t.Fatalf("error=%v", err)
		}
	}
	if len(calls()) != 0 {
		t.Fatalf("called APIs for feed URL: %v", calls())
	}
}

func TestDouyinDemoFixturesMapAppAndWebFields(t *testing.T) {
	for _, kind := range []string{"app", "web"} {
		t.Run(kind, func(t *testing.T) {
			body, err := os.ReadFile("testdata/douyin-demo-" + kind + ".json")
			if err != nil {
				t.Fatal(err)
			}
			var data any
			decoder := json.NewDecoder(strings.NewReader(string(body)))
			decoder.UseNumber()
			if err := decoder.Decode(&data); err != nil {
				t.Fatal(err)
			}
			item := douyinWorkObject(data, "7534641277405531446")
			if item == nil {
				t.Fatal("real Demo structure not recognized")
			}
			work := normalizeWork(item, "")
			stat := directValue(item, "statistics")
			want := metricVO{Play: directString(stat, "play_count"), Like: directString(stat, "digg_count"), Comment: directString(stat, "comment_count"), Share: directString(stat, "share_count"), Favorite: directString(stat, "collect_count")}
			if work.Stats != want {
				t.Fatalf("metrics=%+v want=%+v", work.Stats, want)
			}
			profile := douyinProfile(directValue(item, "author"), "")
			if profile == nil || profile.Name == "" || profile.AvatarURL == "" || profile.PageURL == "" {
				t.Fatalf("profile=%+v", profile)
			}
		})
	}
}

func TestDouyinDoesNotBorrowRecommendedAuthorsOrAnotherAccount(t *testing.T) {
	data := map[string]any{"aweme_detail": nil, "related": map[string]any{"aweme_id": "7669082935156313379", "author": map[string]any{"sec_uid": douyinTestSec}}}
	if douyinWorkObject(data, "7669082935156313379") != nil {
		t.Fatal("recommendation became requested work")
	}
	if douyinProfile(map[string]any{"sec_uid": "MS4wLjABWrong", "nickname": "wrong"}, douyinTestSec) != nil {
		t.Fatal("another account became requested creator")
	}
	rows := map[string]any{"aweme_list": []any{map[string]any{"aweme_id": "1", "author": map[string]any{"sec_uid": "MS4wLjABWrong"}}}}
	if len(douyinAccountWorks(rows, douyinTestSec)) != 0 {
		t.Fatal("another account's posts entered the sample")
	}
	if douyinProfile(map[string]any{"user": nil, "related": map[string]any{"nickname": "wrong", "avatar_medium": map[string]any{"url_list": []any{"https://cdn.example/wrong.jpg"}}}}, douyinTestSec) != nil {
		t.Fatal("recommended author became empty user response")
	}
	profile := douyinProfile(map[string]any{"nickname": "right", "related": map[string]any{"follower_count": 12345}}, douyinTestSec)
	if profile == nil || profile.Followers != "" {
		t.Fatalf("borrowed nested follower count: %+v", profile)
	}
}

func TestDouyinAuthorUIDUsesUIDLookupAndChecksIdentity(t *testing.T) {
	for _, uid := range []string{"12345", "67890"} {
		t.Run(uid, func(t *testing.T) {
			h, cfg, calls := douyinMock(t, map[string]string{
				"/api/v1/douyin/app/v3/fetch_one_video":        `{"code":200,"data":{"aweme_detail":{"aweme_id":"7669082935156313379","author":{"uid":"12345","nickname":"author"}}}}`,
				"/api/v1/douyin/web/fetch_user_profile_by_uid": `{"code":200,"data":{"user":{"uid":"` + uid + `","sec_uid":"MS4wLjABTest","nickname":"author"}}}`,
			})
			source, _ := url.Parse("https://www.douyin.com/jingxuan?modal_id=7669082935156313379")
			identifier, _, fromWork, err := h.douyinAccountIdentity(context.Background(), cfg, source)
			if uid == "12345" && (err != nil || identifier != douyinTestSec || !fromWork) {
				t.Fatalf("id=%s err=%v", identifier, err)
			}
			if uid != "12345" && err == nil {
				t.Fatal("accepted a different UID")
			}
			if requests := calls(); len(requests) != 2 || requests[1] != "/api/v1/douyin/web/fetch_user_profile_by_uid?uid=12345" {
				t.Fatalf("calls=%v", requests)
			}
		})
	}
}

func TestDouyinZeroPostsRequiresSuccessfulListResponse(t *testing.T) {
	profile := &profileVO{Works: "0"}
	if douyinZeroPostAccount(profile, map[string]any{}, nil) {
		t.Fatal("unrecognized response became empty account")
	}
	if douyinZeroPostAccount(profile, map[string]any{"aweme_list": []any{}}, context.DeadlineExceeded) {
		t.Fatal("failed response became empty account")
	}
}

func TestDouyinWebPostsCanSupplementMissingProfile(t *testing.T) {
	h, cfg, _ := douyinMock(t, map[string]string{
		"/api/v1/douyin/app/v3/handler_user_profile":   `{"code":500,"message":"profile unavailable"}`,
		"/api/v1/douyin/app/v3/fetch_user_post_videos": `{"code":200,"data":{"aweme_list":[]}}`,
		"/api/v1/douyin/web/handler_user_profile":      `{"code":500,"message":"profile unavailable"}`,
		"/api/v1/douyin/web/fetch_user_post_videos":    douyinTestPosts,
	})
	source, _ := url.Parse("https://www.douyin.com/user/" + douyinTestSec)
	got, err := h.inspectAccount(context.Background(), cfg, platformDouyin, source)
	if err != nil || got.Profile == nil || got.Profile.Name != "作品作者" || len(got.Works) != 1 {
		t.Fatalf("got=%+v err=%v", got, err)
	}
}
