package social

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"gorm.io/gorm"

	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/videodownload"
)

const testDouyinDownloadID = "7665967735288892672"
const testDouyinDownloadSource = "https://www.douyin.com/jingxuan?modal_id=" + testDouyinDownloadID
const testDouyinHQBody = `{"code":200,"data":{"video_id":"7665967735288892672","original_video_url":"https://v.douyinvod.com/original.mp4","video_data":{"desc":"测试作品","video":{"width":1920,"height":1080,"duration":42000,"data_size":1000}}}}`
const testDouyinHQWeb = "/api/v1/douyin/web/fetch_video_high_quality_play_url"
const testDouyinHQApp = "/api/v1/douyin/app/v3/fetch_video_high_quality_play_url"
const testDouyinDetailV3 = "/api/v1/douyin/app/v3/fetch_one_video_v3"

func TestTikHubDownloadReasonEightUsesV3Immediately(t *testing.T) {
	const observedID = "7665717903026588928"
	const videoJSON = `{"aweme_id":"7665717903026588928","desc":"公开视频","video":{"play_addr":{"url_list":["https://v.douyinvod.com/v3.mp4"]}}}`
	for _, reason := range []string{`8`, `"8"`} {
		for _, detail := range []string{videoJSON, `{"aweme_detail":` + videoJSON + `}`, `{"aweme_details":[` + videoJSON + `]}`} {
			h, cfg, calls := douyinMock(t, map[string]string{
				"/api/v1/douyin/app/v3/fetch_one_video_v2": `{"code":200,"data":{"aweme_detail":null,"filter_list":[{"aweme_id":"7665717903026588928","reason":` + reason + `}]}}`,
				testDouyinDetailV3:                         `{"code":200,"data":` + detail + `}`,
			})
			video, err := h.fetchDouyinDownload(context.Background(), cfg, "https://www.douyin.com/jingxuan?modal_id="+observedID, "compat")
			requests := calls()
			if err != nil || video == nil || video.URLs[0] != "https://v.douyinvod.com/v3.mp4" || len(requests) != 2 || requests[1] != testDouyinDetailV3+"?aweme_id="+observedID {
				t.Fatalf("reason=8 did not resolve via V3: video=%+v err=%v calls=%v", video, err, requests)
			}
		}
	}
}

func TestTikHubDownloadV3FailureRetainsExistingFallbacks(t *testing.T) {
	filtered := `{"code":200,"data":{"aweme_detail":null,"filter_list":[{"aweme_id":"7665967735288892672","reason":8}]}}`
	for _, v3 := range []string{filtered, `{"code":200,"data":{"aweme_detail":{"aweme_id":"99999","video":{"play_addr":{"url_list":["https://v.douyinvod.com/wrong.mp4"]}}}}}`} {
		h, cfg, calls := douyinMock(t, map[string]string{
			"/api/v1/douyin/app/v3/fetch_one_video_v2": filtered,
			testDouyinDetailV3:                         v3,
			"/api/v1/douyin/web/fetch_one_video_v2":    filtered,
			"/api/v1/douyin/app/v3/fetch_one_video":    filtered,
			"/api/v1/douyin/web/fetch_one_video":       filtered,
			testDouyinHQWeb:                            testDouyinHQBody,
		})
		video, err := h.fetchDouyinDownload(context.Background(), cfg, testDouyinDownloadSource, "compat")
		requests := calls()
		if err != nil || video == nil || video.URLs[0] != "https://v.douyinvod.com/original.mp4" || len(requests) != 6 {
			t.Fatalf("V3 prevented existing fallback: %+v %v %v", video, err, requests)
		}
		count := 0
		for _, call := range requests {
			if strings.HasPrefix(call, testDouyinDetailV3+"?") {
				count++
			}
		}
		if count != 1 {
			t.Fatalf("V3 retried indefinitely: %v", requests)
		}
	}
}

func TestTikHubDownloadV3HonorsPrivateContentAndProviderErrors(t *testing.T) {
	for _, response := range []string{
		`{"code":200,"data":{"aweme_detail":{"aweme_id":"7665967735288892672","status":{"is_private":true},"video":{"play_addr":{"url_list":["https://v.douyinvod.com/private.mp4"]}}}}}`,
		`{"code":402,"message":"balance insufficient"}`,
	} {
		h, cfg, calls := douyinMock(t, map[string]string{
			"/api/v1/douyin/app/v3/fetch_one_video_v2": `{"code":200,"data":{"filter_list":[{"reason":8}]}}`,
			testDouyinDetailV3:                         response,
		})
		video, err := h.fetchDouyinDownload(context.Background(), cfg, testDouyinDownloadSource, "compat")
		if err == nil || video != nil || len(calls()) != 2 {
			t.Fatalf("V3 ignored terminal failure: %+v %v %v", video, err, calls())
		}
	}
}

func TestTikHubDownloadReasonEightIsNotReportedAsDeleted(t *testing.T) {
	filtered := `{"code":200,"data":{"filter_list":[{"reason":8}]}}`
	h, cfg, calls := douyinMock(t, map[string]string{
		"/api/v1/douyin/app/v3/fetch_one_video_v2": filtered,
		testDouyinDetailV3:                         filtered,
		"/api/v1/douyin/web/fetch_one_video_v2":    filtered,
		"/api/v1/douyin/app/v3/fetch_one_video":    filtered,
		"/api/v1/douyin/web/fetch_one_video":       filtered,
		testDouyinHQWeb:                            filtered, testDouyinHQApp: filtered,
	})
	_, err := h.fetchDouyinDownload(context.Background(), cfg, testDouyinDownloadSource, "compat")
	if err == nil || !strings.Contains(err.Error(), "reason=8") || strings.Contains(err.Error(), "删除") || len(calls()) != 7 {
		t.Fatalf("misleading or unbounded reason=8 failure: %v %v", err, calls())
	}
}

func TestTikHubDownloadSelectsRenditionsForRequestedQuality(t *testing.T) {
	for _, quality := range []string{"speed", "compat", "quality"} {
		t.Run(quality, func(t *testing.T) {
			h, cfg, calls := douyinMock(t, map[string]string{
				testDouyinHQWeb: testDouyinHQBody,
				"/api/v1/douyin/app/v3/fetch_one_video_v2": `{"code":200,"data":{"aweme_detail":{"aweme_id":"7665967735288892672","video":{"bit_rate":[{"play_addr":{"width":3840,"height":2160,"data_size":100000000,"url_list":["https://v.douyinvod.com/4k.mp4"]}},{"play_addr":{"width":1280,"height":720,"data_size":3000000,"url_list":["https://v.douyinvod.com/720.mp4"]}},{"play_addr":{"width":640,"height":360,"data_size":1000000,"url_list":["https://v.douyinvod.com/360.mp4"]}}]}}}}`,
			})
			video, err := h.fetchDouyinDownload(context.Background(), cfg, testDouyinDownloadSource, quality)
			want := "https://v.douyinvod.com/original.mp4"
			if quality == "speed" {
				want = "https://v.douyinvod.com/360.mp4"
			} else if quality == "compat" {
				want = "https://v.douyinvod.com/720.mp4"
			}
			if err != nil || video == nil || video.URLs[0] != want || len(calls()) != 1 {
				t.Fatalf("quality=%s video=%+v err=%v requests=%v", quality, video, err, calls())
			}
		})
	}
}

func TestTikHubDownloadBusinessErrorsOverrideSuccessMessage(t *testing.T) {
	for status, want := range map[int]string{401: "凭证", 403: "权限", 402: "额度不足", 429: "过于频繁"} {
		t.Run(fmt.Sprint(status), func(t *testing.T) {
			calls := 0
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				calls++
				fmt.Fprintf(w, `{"code":%d,"message":"Request successful"}`, status)
			}))
			defer server.Close()
			h := &handler{httpcli: server.Client()}
			_, err := h.fetchDouyinDownload(context.Background(), settings{baseURL: server.URL, apiKey: "test-key"}, testDouyinDownloadSource, "compat")
			if err == nil || !strings.Contains(err.Error(), want) || strings.Contains(err.Error(), "successful") || calls != 1 {
				t.Fatalf("misleading failure: %v calls=%d", err, calls)
			}
		})
	}
}

func TestTikHubDownloadSettingsQueryHonorsCancellation(t *testing.T) {
	h := &handler{db: activityTestDB(t)}
	if err := h.db.AutoMigrate(&model.SysConfig{}); err != nil {
		t.Fatal(err)
	}
	if err := h.db.Callback().Query().Before("gorm:query").Register("test:waiting_settings", func(tx *gorm.DB) {
		if _, ok := tx.Statement.Context.Deadline(); !ok {
			t.Error("settings query lost caller deadline")
			tx.AddError(context.DeadlineExceeded)
			return
		}
		<-tx.Statement.Context.Done()
		tx.AddError(tx.Statement.Context.Err())
	}); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Millisecond)
	defer cancel()
	_, err := h.resolveDouyinDownload(ctx, testDouyinDownloadSource, "compat")
	var problem *videodownload.Error
	if !errors.As(err, &problem) || problem.Status != 504 {
		t.Fatalf("incorrect cancellation result: %v", err)
	}
}

func TestTikHubDownloadLowQualityUsesOriginalOnlyWhenDetailsHaveNoMedia(t *testing.T) {
	h, cfg, calls := douyinMock(t, map[string]string{
		"/api/v1/douyin/app/v3/fetch_one_video":    `{"code":200,"data":{}}`,
		"/api/v1/douyin/web/fetch_one_video":       `{"code":200,"data":{}}`,
		"/api/v1/douyin/app/v3/fetch_one_video_v2": `{"code":200,"data":{"aweme_detail":{"aweme_id":"7665967735288892672","desc":"no media"}}}`,
		"/api/v1/douyin/web/fetch_one_video_v2":    `{"code":200,"data":{}}`,
		testDouyinHQWeb:                            testDouyinHQBody,
	})
	video, err := h.fetchDouyinDownload(context.Background(), cfg, testDouyinDownloadSource, "speed")
	requests := calls()
	if err != nil || video == nil || video.URLs[0] != "https://v.douyinvod.com/original.mp4" || len(requests) != 5 || !strings.HasPrefix(requests[0], "/api/v1/douyin/app/v3/fetch_one_video_v2?") || !strings.HasPrefix(requests[4], testDouyinHQWeb+"?") {
		t.Fatalf("result=%+v err=%v calls=%v", video, err, requests)
	}
}

func TestTikHubDownloadCancellationStopsRemainingEndpoints(t *testing.T) {
	started := make(chan struct{}, 4)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { started <- struct{}{}; <-r.Context().Done() }))
	defer server.Close()
	h := &handler{httpcli: server.Client()}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan error, 1)
	go func() {
		_, err := h.fetchDouyinDownload(ctx, settings{baseURL: server.URL, apiKey: "test-key"}, testDouyinDownloadSource, "compat")
		done <- err
	}()
	select {
	case <-started:
	case <-time.After(time.Second):
		t.Fatal("request never started")
	}
	cancel()
	select {
	case err := <-done:
		var problem *videodownload.Error
		if !errors.As(err, &problem) || problem.Status != 504 {
			t.Fatalf("unexpected cancel result: %v", err)
		}
	case <-time.After(time.Second):
		t.Fatal("provider did not stop after cancellation")
	}
	if len(started) != 0 {
		t.Fatal("remaining endpoints called after cancellation")
	}
}

func TestTikHubDouyinDownloadParametersAndMetadata(t *testing.T) {
	for _, source := range []string{testDouyinDownloadSource, "https://v.douyin.com/abc123/"} {
		h, cfg, calls := douyinMock(t, map[string]string{testDouyinHQWeb: testDouyinHQBody})
		video, err := h.fetchDouyinDownload(context.Background(), cfg, source, "quality")
		if err != nil || video == nil || video.Title != "测试作品" || video.Width != 1920 || video.Height != 1080 || video.DurationSeconds != 42 || video.EstimatedBytes != 1000 {
			t.Fatalf("unexpected result: %+v %v", video, err)
		}
		requests := calls()
		if len(requests) != 1 {
			t.Fatalf("extra paid requests: %v", requests)
		}
		u, _ := url.Parse(requests[0])
		q := u.Query()
		if q.Get("region") != "CN" {
			t.Fatal("missing domestic CDN region")
		}
		if strings.Contains(source, "modal_id") {
			if q.Get("aweme_id") != testDouyinDownloadID || q.Get("share_url") != "" {
				t.Fatal("incorrect modal ID parameters")
			}
		} else if q.Get("share_url") != source || q.Get("aweme_id") != "" {
			t.Fatal("incorrect short-link parameters")
		}
	}
}

func TestTikHubDouyinDownloadUsesAppBackupAndNormalPlayURL(t *testing.T) {
	for _, detail := range []bool{false, true} {
		t.Run(fmt.Sprint(detail), func(t *testing.T) {
			bodies := map[string]string{testDouyinHQWeb: `{"code":200,"data":{}}`, testDouyinHQApp: testDouyinHQBody}
			wantCalls := 2
			if detail {
				bodies[testDouyinHQApp] = `{"code":200,"data":{}}`
				bodies["/api/v1/douyin/app/v3/fetch_one_video_v2"] = `{"code":200,"data":{"aweme_detail":{"aweme_id":"7665967735288892672","desc":"普通播放","video":{"width":640,"height":360,"play_addr":{"url_list":["https://v.douyinvod.com/normal.mp4"]}}}}}`
				wantCalls = 3
			}
			h, cfg, calls := douyinMock(t, bodies)
			video, err := h.fetchDouyinDownload(context.Background(), cfg, testDouyinDownloadSource, "quality")
			if err != nil || video == nil || len(calls()) != wantCalls {
				t.Fatalf("result=%+v err=%v requests=%v", video, err, calls())
			}
			if detail && video.URLs[0] != "https://v.douyinvod.com/normal.mp4" {
				t.Fatal("normal play address not selected")
			}
		})
	}
}

func TestTikHubDouyinDownloadStopsOnAccountErrors(t *testing.T) {
	for _, status := range []int{401, 402, 403, 429} {
		t.Run(fmt.Sprint(status), func(t *testing.T) {
			calls := 0
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				calls++
				w.WriteHeader(status)
				_, _ = w.Write([]byte(`{"message":"upstream failure"}`))
			}))
			defer server.Close()
			h := &handler{httpcli: server.Client()}
			_, err := h.fetchDouyinDownload(context.Background(), settings{baseURL: server.URL, apiKey: "test-key"}, testDouyinDownloadSource, "compat")
			var problem *videodownload.Error
			if !errors.As(err, &problem) || problem.Status != 503 || !strings.Contains(problem.Message, "TikHub") || calls != 1 {
				t.Fatalf("err=%v calls=%d", err, calls)
			}
		})
	}
}

func TestTikHubDouyinDownloadDetailNeedsMediaNotJustMetadata(t *testing.T) {
	h, cfg, calls := douyinMock(t, map[string]string{
		testDouyinHQWeb: `{"code":200,"data":{}}`, testDouyinHQApp: `{"code":200,"data":{}}`,
		"/api/v1/douyin/app/v3/fetch_one_video_v2": `{"code":200,"data":{"aweme_detail":{"aweme_id":"7665967735288892672","desc":"只有标题"}}}`,
		"/api/v1/douyin/web/fetch_one_video_v2":    `{"code":200,"data":{"aweme_detail":{"aweme_id":"7665967735288892672","desc":"带有视频","video":{"play_addr":{"url_list":["https://v.douyinvod.com/web.mp4"]}}}}}`,
	})
	video, err := h.fetchDouyinDownload(context.Background(), cfg, testDouyinDownloadSource, "speed")
	if err != nil || video == nil || video.URLs[0] != "https://v.douyinvod.com/web.mp4" || len(calls()) != 2 {
		t.Fatalf("result=%+v err=%v calls=%v", video, err, calls())
	}
}

func TestTikHubDouyinDownloadStopsOnPrivateWorkAndCancellation(t *testing.T) {
	h, cfg, calls := douyinMock(t, map[string]string{
		testDouyinHQWeb: `{"code":200,"data":{}}`, testDouyinHQApp: `{"code":200,"data":{}}`,
		"/api/v1/douyin/app/v3/fetch_one_video_v2": `{"code":200,"data":{"aweme_detail":null,"filter_list":[{"reason":"5"}]}}`,
	})
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	_, err := h.fetchDouyinDownload(ctx, cfg, testDouyinDownloadSource, "compat")
	var problem *videodownload.Error
	if !errors.As(err, &problem) || problem.Status != 504 || len(calls()) != 0 {
		t.Fatal("cancellation did not stop provider")
	}
	_, err = h.fetchDouyinDownload(context.Background(), cfg, testDouyinDownloadSource, "compat")
	if !errors.As(err, &problem) || problem.Status != 400 || len(calls()) != 1 {
		t.Fatalf("private work retries: err=%v calls=%v", err, calls())
	}
}

func TestTikHubDouyinDownloadReadsLiveAdminSettings(t *testing.T) {
	h, cfg, calls := douyinMock(t, map[string]string{testDouyinHQWeb: testDouyinHQBody})
	h.db = activityTestDB(t)
	if err := h.db.AutoMigrate(&model.SysConfig{}); err != nil {
		t.Fatal(err)
	}
	rows := []model.SysConfig{
		{ConfigKey: model.ConfigKeySocialTikHubEnabled, ConfigValue: "0"},
		{ConfigKey: model.ConfigKeySocialTikHubBaseURL, ConfigValue: cfg.baseURL},
		{ConfigKey: model.ConfigKeySocialTikHubAPIKey, ConfigValue: "Bearer test-key"},
	}
	if err := h.db.Create(&rows).Error; err != nil {
		t.Fatal(err)
	}
	video, err := h.resolveDouyinDownload(context.Background(), testDouyinDownloadSource, "quality")
	if video != nil || err != nil || len(calls()) != 0 {
		t.Fatal("disabled provider was called")
	}
	h.db.Model(&model.SysConfig{}).Where("config_key = ?", model.ConfigKeySocialTikHubEnabled).Update("config_value", "1")
	video, err = h.resolveDouyinDownload(context.Background(), testDouyinDownloadSource, "quality")
	if video == nil || err != nil || len(calls()) != 1 {
		t.Fatalf("enabled provider failed: %v", err)
	}
	h.db.Model(&model.SysConfig{}).Where("config_key = ?", model.ConfigKeySocialTikHubAPIKey).Update("config_value", "")
	video, err = h.resolveDouyinDownload(context.Background(), testDouyinDownloadSource, "quality")
	if video != nil || err != nil || len(calls()) != 1 {
		t.Fatal("removed credential remained active")
	}
}
