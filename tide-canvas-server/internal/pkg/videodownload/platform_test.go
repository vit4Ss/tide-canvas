package videodownload

import (
	"context"
	"net/http"
	"testing"
)

func TestDouyinCategoryModalLinks(t *testing.T) {
	const id = "7681195541069434146"
	const want = "https://www.douyin.com/video/" + id
	for _, path := range []string{"/jingxuan/game", "/jingxuan/game/", "/jingxuan/music", "/jingxuan", "/discover", "/"} {
		t.Run(path, func(t *testing.T) {
			source, platform, err := ValidateSource("https://www.douyin.com" + path + "?modal_id=" + id + "&recommend=1")
			if err != nil || platform != "douyin" || source != want {
				t.Fatalf("source=%q platform=%q err=%v, want %q", source, platform, err, want)
			}
		})
	}
	for _, raw := range []string{
		"https://www.douyin.com/jingxuan/game",
		"https://www.douyin.com/jingxuan/game?modal_id=",
		"https://www.douyin.com/jingxuan/game?modal_id=wrong",
		"https://www.douyin.com/jingxuan/game?modal_id=" + id + "&modal_id=12345",
		"https://www.douyin.com/jingxuan/game?modal_id=" + id + "&modal_id=" + id,
		"https://www.douyin.com/jingxuan/game?modal_id=" + id + "&invalid=%zz",
		"https://www.douyin.com/jingxuan/game/details?modal_id=" + id,
		"https://www.douyin.com/jingxuan-game?modal_id=" + id,
		"https://www.douyin.com/search/game?modal_id=" + id,
		"https://www.douyin.com/user/12345?modal_id=" + id,
		"https://www.douyin.com/jingxuan/../search?modal_id=" + id,
		"https://www.douyin.com.evil.test/jingxuan/game?modal_id=" + id,
		"https://www.douyin.com:8443/jingxuan/game?modal_id=" + id,
	} {
		t.Run(raw, func(t *testing.T) {
			_, _, err := ValidateSource(raw)
			requireError(t, err, 400)
		})
	}
}

func TestDouyinCategoryResolveReachesProviderWithCanonicalWork(t *testing.T) {
	const id = "7681195541069434146"
	for _, quality := range []string{"quality", "compat", "speed"} {
		t.Run(quality, func(t *testing.T) {
			s := testService(t)
			s.client.Transport = roundTripFunc(func(r *http.Request) (*http.Response, error) {
				if r.URL.Path != "/share/video/"+id+"/" {
					t.Fatalf("must fetch the work instead of the category page: %s", r.URL)
				}
				resp := responseFor(r, "blocked", "text/html")
				resp.StatusCode = http.StatusForbidden
				return resp, nil
			})
			calls := 0
			s.douyinFallback = func(_ context.Context, source, requestedQuality string) (*ResolvedVideo, error) {
				calls++
				if source != "https://www.douyin.com/video/"+id || requestedQuality != quality {
					t.Fatalf("wrong provider request: %q quality=%q", source, requestedQuality)
				}
				return &ResolvedVideo{Metadata: Metadata{Title: "分类页视频", Width: 1920, Height: 1080, EstimatedBytes: 100}, URLs: []string{"https://v.douyinvod.com/public.mp4"}}, nil
			}
			video, err := s.Resolve(context.Background(), "https://www.douyin.com/jingxuan/game?modal_id="+id, quality)
			if err != nil || video.Title != "分类页视频" || calls != 1 {
				t.Fatalf("video=%+v error=%v calls=%d", video, err, calls)
			}
		})
	}
}
