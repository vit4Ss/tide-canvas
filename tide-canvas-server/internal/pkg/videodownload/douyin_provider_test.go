package videodownload

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"strings"
	"testing"
)

func TestDouyinProviderVideoRejectsWrongWorkAndUnsafeMedia(t *testing.T) {
	for _, body := range []string{
		`{"video_id":"99999","original_video_url":"https://v.douyinvod.com/v.mp4"}`,
		`{"original_video_url":"https://127.0.0.1/private.mp4"}`,
		`{"original_video_url":"https://douyinvod.com.evil.test/private.mp4"}`,
		`{"original_video_url":"https://v.douyinvod.com/v.mp4","video_data":{"aweme_id":"99999"}}`,
		`{"original_video_url":"https://v.douyinvod.com/v.mp4","video_data":{"status":{"is_private":1}}}`,
		`{"original_video_url":"https://v.douyinvod.com/v.mp4","video_data":{"images":[{}]}}`,
	} {
		data, _ := decodeJSON(strings.NewReader(body))
		if _, err := DouyinProviderVideo(data, "https://www.douyin.com/video/12345", "compat"); err == nil {
			t.Fatalf("invalid provider result accepted: %s", body)
		}
	}
	data, _ := decodeJSON(strings.NewReader(`{"video_id":"v0300-media-id","original_video_url":"https://v.douyinvod.com/v.mp4"}`))
	for _, source := range []string{"https://v.douyin.com/abc123/", "https://www.douyin.com/video/12345"} {
		video, err := DouyinProviderVideo(data, source, "compat")
		if err != nil || video == nil || video.SourceURL != source {
			t.Fatalf("media identifier treated as work ID: %+v %v", video, err)
		}
	}
}

func TestDouyinProviderMetadataDistinguishesSecondsAndMilliseconds(t *testing.T) {
	for _, metadata := range []string{
		`"video":{"width":1280,"height":720,"duration":42000,"data_size":1000}`,
		`"format":{"duration":"42","size":"1000"},"streams":[{"codec_type":"video","width":1280,"height":720}]`,
	} {
		data, _ := decodeJSON(strings.NewReader(`{"original_video_url":"https://v.douyinvod.com/v.mp4","video_data":{` + metadata + `}}`))
		video, err := DouyinProviderVideo(data, "https://www.douyin.com/video/12345", "compat")
		if err != nil || video == nil || video.DurationSeconds != 42 || video.Width != 1280 || video.Height != 720 || video.EstimatedBytes != 1000 {
			t.Fatalf("wrong metadata: %+v %v", video, err)
		}
	}
}

func TestDouyinProviderLimitsAndUnconfiguredFallback(t *testing.T) {
	for _, scenario := range []string{"oversized", "unsafe", "unconfigured", "short-link"} {
		t.Run(scenario, func(t *testing.T) {
			s := testService(t)
			s.client.Transport = roundTripFunc(func(r *http.Request) (*http.Response, error) {
				return responseFor(r, "no video state", "text/html"), nil
			})
			calls := 0
			s.douyinFallback = func(context.Context, string, string) (*ResolvedVideo, error) {
				calls++
				switch scenario {
				case "oversized":
					return &ResolvedVideo{Metadata: Metadata{EstimatedBytes: s.MaxBytes() + 1}, URLs: []string{"https://v.douyinvod.com/v.mp4"}}, nil
				case "unsafe":
					return &ResolvedVideo{URLs: []string{"https://127.0.0.1/v.mp4"}}, nil
				case "short-link":
					return &ResolvedVideo{Metadata: Metadata{Title: "分享视频"}, URLs: []string{"https://v.douyinvod.com/v.mp4"}}, nil
				default:
					return nil, nil
				}
			}
			if scenario == "unconfigured" {
				s.run = func(context.Context, string, []string, string, int64) ([]byte, []byte, error) {
					return []byte(`{"title":"local extractor"}`), nil, nil
				}
			}
			source := "https://www.douyin.com/video/12345"
			if scenario == "short-link" {
				source = "https://v.douyin.com/abc123/"
			}
			_, err := s.Resolve(context.Background(), source, "compat")
			switch scenario {
			case "oversized":
				requireError(t, err, 400)
			case "unsafe":
				requireError(t, err, 502)
			default:
				if err != nil {
					t.Fatal(err)
				}
			}
			if calls != 1 || len(s.resolves) != 0 {
				t.Fatal("fallback calls or semaphore invalid")
			}
		})
	}
}

func TestDouyinBlockedSharePageUsesProvider(t *testing.T) {
	for _, status := range []int{401, 403, 404, 500} {
		t.Run(fmt.Sprint(status), func(t *testing.T) {
			s := testService(t)
			s.client.Transport = roundTripFunc(func(r *http.Request) (*http.Response, error) {
				resp := responseFor(r, "blocked", "text/html")
				resp.StatusCode = status
				return resp, nil
			})
			calls := 0
			s.douyinFallback = func(ctx context.Context, source, quality string) (*ResolvedVideo, error) {
				calls++
				if source != "https://www.douyin.com/video/12345" || quality != "speed" {
					t.Fatal("source/quality changed")
				}
				return &ResolvedVideo{Metadata: Metadata{Title: "TikHub视频", Width: 1920, Height: 1080, EstimatedBytes: 100}, URLs: []string{"https://v.douyinvod.com/v.mp4"}}, nil
			}
			video, err := s.Resolve(context.Background(), "https://www.douyin.com/jingxuan?modal_id=12345", "speed")
			if err != nil || video.Title != "TikHub视频" || video.Height != 480 || calls != 1 {
				t.Fatalf("video=%+v err=%v calls=%d", video, err, calls)
			}
		})
	}
}

func TestDouyinConfirmedRestrictionsDoNotCallProvider(t *testing.T) {
	for _, extra := range []string{`"status":{"is_private":1}`, `"status":{"is_delete":true}`, `"images":[{}]`} {
		s := testService(t)
		s.client.Transport = roundTripFunc(func(r *http.Request) (*http.Response, error) {
			return responseFor(r, `<script>window._ROUTER_DATA={"aweme_id":"12345",`+extra+`};</script>`, "text/html"), nil
		})
		s.douyinFallback = func(context.Context, string, string) (*ResolvedVideo, error) {
			t.Fatal("provider called for restricted/non-video work")
			return nil, nil
		}
		_, err := s.Resolve(context.Background(), "https://www.douyin.com/video/12345", "compat")
		requireError(t, err, 400)
	}
}

func TestDouyinDownloadRetriesExpiredNativeMediaOnlyOnce(t *testing.T) {
	for _, fail := range []bool{false, true} {
		t.Run(fmt.Sprint(fail), func(t *testing.T) {
			s := testService(t)
			s.client.Transport = roundTripFunc(func(r *http.Request) (*http.Response, error) {
				if r.URL.Host == "www.iesdouyin.com" {
					return responseFor(r, `<script>window._ROUTER_DATA={"aweme_id":"12345","video":{"height":360,"width":640,"play_addr":{"url_list":["https://v.douyinvod.com/expired.mp4"]}}};</script>`, "text/html"), nil
				}
				resp := responseFor(r, "media", "video/mp4")
				if r.URL.Path == "/expired.mp4" || fail {
					resp.StatusCode = 403
				}
				return resp, nil
			})
			calls := 0
			s.douyinFallback = func(context.Context, string, string) (*ResolvedVideo, error) {
				calls++
				return &ResolvedVideo{URLs: []string{"https://v.douyinvod.com/fresh.mp4"}}, nil
			}
			s.run = func(_ context.Context, _ string, args []string, _ string, _ int64) ([]byte, []byte, error) {
				if strings.Contains(strings.Join(args, " "), "-show_entries") {
					return []byte(`{"streams":[{"codec_type":"video","codec_name":"h264","pix_fmt":"yuv420p","height":360,"width":640}]}`), nil, nil
				}
				return nil, nil, os.WriteFile(args[len(args)-1], []byte("finished media"), 0600)
			}
			file, err := s.Download(context.Background(), "https://www.douyin.com/video/12345", "compat")
			if fail {
				requireError(t, err, 502)
			} else {
				if err != nil {
					t.Fatal(err)
				}
				file.Close()
			}
			if calls != 1 {
				t.Fatalf("fallback calls=%d", calls)
			}
			entries, _ := os.ReadDir(s.cfg.TempDir)
			if len(entries) != 0 || len(s.downloads) != 0 {
				t.Fatal("fallback leaked temp files or concurrency slot")
			}
		})
	}
}
