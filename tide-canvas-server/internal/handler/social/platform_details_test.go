package social

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func platformFixture(t *testing.T, value string) any {
	t.Helper()
	var result any
	decoder := json.NewDecoder(strings.NewReader(value))
	decoder.UseNumber()
	if err := decoder.Decode(&result); err != nil {
		t.Fatal(err)
	}
	return result
}
func detailField(d *platformDetailsVO, key string) string {
	if d != nil {
		for _, f := range d.Fields {
			if f.Key == key {
				return f.Value
			}
		}
	}
	return ""
}

func TestPlatformSpecificPublicData(t *testing.T) {
	tests := []struct {
		p                                      platform
		body, like, extraKey, extraValue, kind string
	}{
		{platformBilibili, `{"data":{"bvid":"BV1114y1X7TA","title":"Bili","tname":"数码","stat":{"view":1000,"like":20,"coin":5,"danmaku":0},"pages":[{"part":"第一章","duration":90}]}}`, "20", "category", "数码", "video"},
		{platformDouyin, `{"aweme_detail":{"aweme_id":7669082935156313379,"desc":"抖音","aweme_type":0,"statistics":{"digg_count":12,"collect_count":3,"download_count":0},"music":{"title":"原声","author":"作曲者"},"author":{"nickname":"作者","like_count":999},"cha_list":[{"cha_name":"教程"}]}}`, "12", "music", "原声", "video"},
		{platformXiaohongshu, `{"data":{"items":[{"note_card":{"note_id":"note1","title":"笔记","type":"normal","interact_info":{"liked_count":"1.2万","collected_count":30,"comment_count":5},"image_list":[{"url_default":"https://cdn.example/1.jpg"},{"url_default":"https://cdn.example/2.jpg"}],"music":{"play_url":"https://cdn.example/music.mp4"},"tag_list":[{"name":"穿搭"}]}}]}}`, "1.2万", "imageCount", "2", "image"},
		{platformYouTube, `{"video_id":"abcdefghijk","title":"YouTube","length_seconds":125,"view_count":1000,"like_count":22,"published_at":"2026-08-01","language":"en","keywords":["design"],"chapters":[{"title":"Intro","start_time":0},{"title":"Design","start_time":30}],"captions":[{"language":"en"}]}`, "22", "language", "en", "video"},
		{platformTikTok, `{"data":{"aweme_details":[{"aweme_id":"12345","desc":"Clip","aweme_type":0,"statistics":{"digg_count":8,"share_count":2},"region":"US","music":{"title":"song"}}]}}`, "8", "region", "US", "video"},
		{platformKuaishou, `{"data":{"photo":{"id":"ks1","caption":"快手","photoType":"video","viewCount":100,"likeCount":10,"commentCount":3,"music":{"name":"背景音乐"}}}}`, "10", "music", "背景音乐", "video"},
	}
	for _, test := range tests {
		t.Run(string(test.p), func(t *testing.T) {
			work := normalizePlatformWork(test.p, platformFixture(t, test.body), "")
			if work.Platform != test.p || work.Stats.Like != test.like || work.MediaType != test.kind || detailField(work.Details, test.extraKey) != test.extraValue {
				t.Fatalf("work = %+v details=%+v", work, work.Details)
			}
			if test.p == platformBilibili && (work.Stats.Coin != "5" || work.Stats.Danmaku != "0" || len(work.Details.Chapters) != 1) {
				t.Fatal(work)
			}
			if test.p == platformDouyin && (work.ID != "7669082935156313379" || work.Stats.Download != "0") {
				t.Fatal(work)
			}
			if test.p == platformXiaohongshu && (work.MediaURL != "" || work.Duration != "" || work.Stats.Play != "") {
				t.Fatal("image note borrowed music/video fields", work)
			}
			if test.p == platformYouTube && (work.Duration != "02:05" || len(work.Details.Chapters) != 2 || *work.Details.Chapters[0].Start != 0 || len(work.Details.Languages) != 1) {
				t.Fatal(work)
			}
		})
	}
}

func TestPublicProjectionDoesNotBorrowRelatedStatisticsOrSecrets(t *testing.T) {
	root := platformFixture(t, `{"data":{"aweme_detail":{"aweme_id":"1234","desc":"clip","statistics":{"digg_count":0},"author":{"nickname":"A","like_count":9000},"music":{"title":"M","author":"B","comment_count":888},"auth_token":"secret","cookie":"secret"},"recommendations":[{"aweme_id":"other","play_count":99999}]}}`)
	work := normalizePlatformWork(platformTikTok, root, "")
	if work.Stats.Like != "0" || work.Stats.Play != "" || work.Stats.Comment != "" {
		t.Fatal(work.Stats)
	}
	if work.Title != "clip" {
		t.Fatal("borrowed the music title", work.Title)
	}
	encoded, _ := json.Marshal(work.Details)
	if strings.Contains(string(encoded), "secret") {
		t.Fatal(string(encoded))
	}
}

func TestPlatformRowsEmptyAndRelatedListsStayEmpty(t *testing.T) {
	for _, root := range []any{nil, map[string]any{}, platformFixture(t, `{"data":{"aweme_list":[]},"recommendations":[{"aweme_id":"ad","desc":"advert"}]}`)} {
		if works := normalizePlatformWorks(platformDouyin, root); len(works) != 0 {
			t.Fatal(works)
		}
	}
	work := normalizePlatformWork(platformDouyin, platformFixture(t, `{"aweme_detail":{"aweme_id":"123","desc":"content","aweme_type":0,"music":{"title":"song","duration":60000,"play_url":"https://cdn.example/music.mp4"}}}`), "")
	if work.MediaURL != "" || work.Title != "content" || work.Duration != "" {
		t.Fatal("borrowed a soundtrack", work)
	}
}

func TestYouTubeWatchPageNeverBecomesMedia(t *testing.T) {
	info := platformFixture(t, `{"video_id":"abcdefghijk","title":"Video","video_url":"https://www.youtube.com/watch?v=abcdefghijk","view_count":10}`)
	work := normalizePlatformWork(platformYouTube, info, "https://www.youtube.com/watch?v=abcdefghijk")
	if work.MediaURL != "" || len(work.MediaURLs) != 0 {
		t.Fatal("watch page became a video asset", work)
	}
	work = normalizePlatformWork(platformYouTube, []any{map[string]any{"preferred_media_url": "https://cdn.example/merged.mp4"}, info}, "")
	if work.MediaURL != "https://cdn.example/merged.mp4" || work.Stats.Play != "10" {
		t.Fatal(work)
	}
}

func TestPlatformProfilesAndCombinedXHSCounters(t *testing.T) {
	xhs := platformProfile(platformXiaohongshu, platformFixture(t, `{"data":{"basic_info":{"user_id":"x1","nickname":"博主","red_id":"123"},"interactions":[{"type":"fans","count":"100"},{"type":"follows","count":"20"},{"type":"interaction","count":"1500"}]}}`), nil, true)
	if xhs == nil || xhs.Followers != "100" || xhs.Following != "20" || detailField(xhs.Details, "likesAndCollects") != "1500" || xhs.Likes != "" {
		t.Fatalf("%+v", xhs)
	}
	bili := platformProfile(platformBilibili, []any{platformFixture(t, `{"mid":1,"name":"UP","level":6,"official":{"title":"认证"}}`), platformFixture(t, `{"archive":{"view":10000},"article":{"view":200}}`)}, nil, true)
	if bili == nil || detailField(bili.Details, "level") != "6" || detailField(bili.Details, "totalViews") != "10000" {
		t.Fatalf("%+v %+v", bili, bili.Details)
	}
}

func TestAccountDetailEnrichmentBoundedAndPreservesFailures(t *testing.T) {
	var active, peak, calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		n := active.Add(1)
		defer active.Add(-1)
		for old := peak.Load(); n > old; old = peak.Load() {
			if peak.CompareAndSwap(old, n) {
				break
			}
		}
		time.Sleep(5 * time.Millisecond)
		id := r.URL.Query().Get("bv_id")
		if id == "" {
			t.Error("Bilibili requires bv_id, not bvid")
		}
		if strings.HasSuffix(id, "1") {
			w.WriteHeader(503)
			return
		}
		fmt.Fprintf(w, `{"code":200,"data":{"bvid":%q,"title":"detail","stat":{"view":0,"like":2,"coin":1,"danmaku":0}}}`, id)
	}))
	defer server.Close()
	works := []workVO{}
	for i := 0; i < 7; i++ {
		works = append(works, workVO{ID: fmt.Sprintf("BV000000000%d", i), Title: "list", Stats: metricVO{Play: "100", Comment: "3"}})
	}
	h := handler{httpcli: server.Client()}
	missing := h.enrichAccountWorks(context.Background(), settings{baseURL: server.URL, apiKey: "test"}, platformBilibili, works)
	if missing != 1 || peak.Load() > 3 || calls.Load() != 7 {
		t.Fatalf("missing=%d peak=%d calls=%d", missing, peak.Load(), calls.Load())
	}
	if works[0].Stats.Play != "0" || works[0].Stats.Comment != "3" || works[1].Title != "list" {
		t.Fatal(works)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	before := calls.Load()
	h.enrichAccountWorks(ctx, settings{baseURL: server.URL}, platformBilibili, works)
	if calls.Load() != before {
		t.Fatal("cancelled enrichment made a new request")
	}
}

func TestPlatformDetailsSurviveSnapshotRoundTrip(t *testing.T) {
	work := normalizePlatformWork(platformBilibili, platformFixture(t, `{"bvid":"BV1114y1X7TA","title":"B","stat":{"coin":1,"danmaku":0},"tname":"数码"}`), "")
	encoded, _ := json.Marshal(inspectVO{Content: &work, Works: []workVO{work}})
	var decoded inspectVO
	if err := json.Unmarshal(encoded, &decoded); err != nil {
		t.Fatal(err)
	}
	if decoded.Content.Stats.Danmaku != "0" || detailField(decoded.Works[0].Details, "category") != "数码" {
		t.Fatal(string(encoded))
	}
}

func TestContentProfileOnlyUsesTheWorkAuthor(t *testing.T) {
	root := platformFixture(t, `{"aweme_detail":{"aweme_id":"123","desc":"video caption","statistics":{"like_count":200},"author":{"uid":"a1","nickname":"Creator"},"music":{"author":{"uid":"m1","nickname":"Musician","follower_count":9000,"total_favorited":8000,"avatar":"https://cdn.example/music.jpg"}}}}`)
	profile := platformProfile(platformTikTok, root, nil, false)
	if profile == nil || profile.ID != "a1" || profile.Name != "Creator" || profile.Followers != "" || profile.Likes != "" || profile.AvatarURL != "" || profile.Bio != "" {
		t.Fatalf("profile borrowed unrelated data: %+v", profile)
	}
	noAuthor := platformFixture(t, `{"aweme_detail":{"aweme_id":"123","desc":"video caption","music":{"author":{"nickname":"Musician"}}}}`)
	if profile := platformProfile(platformTikTok, noAuthor, nil, false); profile != nil {
		t.Fatalf("music author became creator: %+v", profile)
	}
}

func TestWorkWrapperDoesNotHideNestedDetail(t *testing.T) {
	root := platformFixture(t, `{"data":{"items":[{"note_id":"note1","note_card":{"note_id":"note1","title":"Actual title","type":"video","statistics":{},"interact_info":{"liked_count":9,"collected_count":0},"video":{"master_url":"https://cdn.example/work.mp4"}}}]}}`)
	work := normalizePlatformWork(platformXiaohongshu, root, "")
	if work.Title != "Actual title" || work.Stats.Like != "9" || work.Stats.Favorite != "0" || work.MediaURL != "https://cdn.example/work.mp4" {
		t.Fatalf("lost nested detail: %+v", work)
	}
}

func TestXHSVideoSupplementIgnoresSoundtrackAndRejectsOtherNotes(t *testing.T) {
	for _, same := range []bool{true, false} {
		t.Run(fmt.Sprint(same), func(t *testing.T) {
			var calls atomic.Int32
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				calls.Add(1)
				if strings.Contains(r.URL.Path, "get_image_note_detail") {
					fmt.Fprint(w, `{"code":200,"data":{"note_id":"note1","title":"video note","type":"video","music":{"play_url":"https://cdn.example/music.mp4"}}}`)
					return
				}
				id := "note1"
				if !same {
					id = "other"
				}
				fmt.Fprintf(w, `{"code":200,"data":{"note_id":%q,"type":"video","title":"supplement","video":{"master_url":"https://cdn.example/video.mp4"}}}`, id)
			}))
			defer server.Close()
			source, _ := url.Parse("https://www.xiaohongshu.com/explore/note1")
			h := handler{httpcli: server.Client()}
			result, err := h.inspectContent(context.Background(), settings{baseURL: server.URL}, platformXiaohongshu, source)
			if err != nil || result == nil || result.Content == nil {
				t.Fatal(result, err)
			}
			if calls.Load() != 2 {
				t.Fatalf("supplement skipped due to soundtrack: %d calls", calls.Load())
			}
			if same && result.Content.MediaURL != "https://cdn.example/video.mp4" {
				t.Fatal(result.Content)
			}
			if !same && (result.Content.MediaURL != "" || len(result.Warnings) == 0) {
				t.Fatal("mismatched supplement was not explained", result)
			}
		})
	}
}

func TestPartialEnrichmentKeepsExistingAssetsAndNativeCounters(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprint(w, `{"code":200,"data":{"bvid":"BV1114y1X7TA","title":"detail","stat":{"view":100,"like":0,"reply":5}}}`)
	}))
	defer server.Close()
	works := []workVO{{ID: "BV1114y1X7TA", Title: "list", MediaType: "video", MediaURL: "https://cdn.example/video.mp4", MediaURLs: []string{"https://cdn.example/video.mp4"}, ImageURLs: []string{"https://cdn.example/image.jpg"}, Stats: metricVO{Like: "9", Coin: "3", Danmaku: "2"}, Details: &platformDetailsVO{Tags: []string{"Tech"}}}}
	h := handler{httpcli: server.Client()}
	h.enrichAccountWorks(context.Background(), settings{baseURL: server.URL}, platformBilibili, works)
	if works[0].MediaURL == "" || len(works[0].ImageURLs) != 1 || works[0].Stats.Like != "0" || works[0].Stats.Coin != "3" || works[0].Stats.Danmaku != "2" || len(works[0].Details.Tags) != 1 {
		t.Fatalf("enrichment erased data: %+v", works[0])
	}
}

func TestProfileCountersInKnownEnvelopeAndFallbackAuthor(t *testing.T) {
	profile := platformProfile(platformTikTok, platformFixture(t, `{"data":{"userInfo":{"user":{"id":"creator1","nickname":"Creator"},"stats":{"followerCount":20,"followingCount":0,"videoCount":12}},"music":{"author":{"followerCount":999}}}}`), nil, true)
	if profile == nil || profile.Followers != "20" || profile.Following != "0" || profile.Works != "12" || profile.Likes != "" {
		t.Fatalf("lost envelope statistics: %+v", profile)
	}
	profile = platformProfile(platformTikTok, nil, platformFixture(t, `{"aweme_list":[{"aweme_id":"1","desc":"caption","statistics":{"digg_count":500},"author":{"uid":"creator1","nickname":"Creator","follower_count":0}}]}`), true)
	if profile == nil || profile.ID != "creator1" || profile.Followers != "0" || profile.Likes != "" || profile.Bio != "" {
		t.Fatalf("incorrect author fallback: %+v", profile)
	}
	profile = platformProfile(platformYouTube, platformFixture(t, `{"video_id":"video1","title":"Video","description":"video description","channel_id":"channel1","channel":"Creator","channel_follower_count":50,"view_count":900}`), nil, false)
	if profile == nil || profile.ID != "channel1" || profile.Name != "Creator" || profile.Followers != "50" || profile.Bio != "" || detailField(profile.Details, "totalViews") != "" {
		t.Fatalf("flattened channel borrowed video values: %+v", profile)
	}
}

func TestNoteCardIdentityAndOwnMediaIsolation(t *testing.T) {
	work := normalizePlatformWork(platformXiaohongshu, platformFixture(t, `{"items":[{"id":"note1","note_card":{"title":"Note","type":"normal","image_list":[{"url":"https://cdn.example/note.jpg"}]}}]}`), "")
	if work.ID != "note1" || work.Title != "Note" || work.CoverURL != "https://cdn.example/note.jpg" {
		t.Fatalf("lost envelope identity: %+v", work)
	}
	work = normalizePlatformWork(platformTikTok, platformFixture(t, `{"aweme_id":"1","desc":"Clip","aweme_type":0,"music":{"cover":"https://cdn.example/music.jpg","share_url":"https://example.com/music"},"author":{"avatar":"https://cdn.example/author.jpg"}}`), "https://www.tiktok.com/@creator/video/1")
	if work.CoverURL != "" || len(work.ImageURLs) != 0 || work.PageURL != "https://www.tiktok.com/@creator/video/1" {
		t.Fatalf("unrelated media became work cover/page: %+v", work)
	}
	work = normalizePlatformWork(platformXiaohongshu, platformFixture(t, `{"note_id":"note1","note_card":{"note_id":"other","title":"Wrong note"}}`), "")
	if work.ID != "note1" || work.Title != "" {
		t.Fatalf("mismatched card overwrote envelope: %+v", work)
	}
}

func TestCaptionlessWorksStillKeepMediaAndStatistics(t *testing.T) {
	for _, p := range []platform{platformTikTok, platformKuaishou} {
		raw := platformFixture(t, `{"itemStruct":{"id":"clip1","desc":"","video":{"play_addr":{"url_list":["https://cdn.example/clip.mp4"]}},"stats":{"diggCount":0}}}`)
		if p == platformKuaishou {
			raw = platformFixture(t, `{"photo":{"id":"clip1","caption":"","photoType":"video","mainMvUrls":[{"url":"https://cdn.example/clip.mp4"}],"likeCount":0}}`)
		}
		work := normalizePlatformWork(p, raw, "")
		if work.ID != "clip1" || work.MediaType != "video" || work.MediaURL != "https://cdn.example/clip.mp4" || work.Stats.Like != "0" {
			t.Errorf("%s dropped captionless clip: %+v", p, work)
		}
	}
}

func TestKuaishouFlattenedCreatorIsRetained(t *testing.T) {
	raw := platformFixture(t, `{"photo":{"photoId":"5213479667346575810","caption":"Clip","userName":"Creator","userEid":"creator1","headUrl":"https://cdn.example/creator.jpg","viewCount":100,"likeCount":50,"soundTrack":{"userName":"Musician","fanCount":999}},"counts":{"fanCount":20,"followCount":0,"photoCount":12}}`)
	profile := platformProfile(platformKuaishou, raw, nil, false)
	if profile == nil || profile.ID != "creator1" || profile.Name != "Creator" || profile.AvatarURL != "https://cdn.example/creator.jpg" || profile.Followers != "20" || profile.Following != "0" || profile.Works != "12" || profile.Likes != "" || profile.Bio != "" {
		t.Fatalf("lost flattened creator: %+v", profile)
	}
}

func TestYouTubeStreamsCannotComeFromRecommendations(t *testing.T) {
	root := platformFixture(t, `{"data":{"video_id":"main","formats":[],"recommendations":[{"video_id":"other","formats":[{"itag":18,"mime_type":"video/mp4","url":"https://cdn.example/other.mp4"}]}]}}`)
	// An empty target stream list must stay empty, even if a related item plays.
	if got := findYouTubeMergedMediaURL(root); got != "" {
		t.Fatalf("borrowed a recommended video: %s", got)
	}
	root = platformFixture(t, `{"data":{"video_id":"main","recommendations":[{"video_id":"other","formats":[{"itag":18,"mime_type":"video/mp4","url":"https://cdn.example/other.mp4"}]}]}}`)
	if got := findYouTubeMergedMediaURL(root); got != "" {
		t.Fatalf("borrowed a recommended video when formats missing: %s", got)
	}
}

func TestYouTubeStreamRequiresAUsableCombinedURL(t *testing.T) {
	raw := platformFixture(t, `{"formats":[{"itag":18,"mime_type":"video/mp4","has_signature":true,"url":"https://cdn.example/encrypted.mp4"},{"itag":22,"mime_type":"video/mp4","has_signature":false,"url":"https://cdn.example/combined.mp4"}],"adaptive_formats":[{"itag":137,"mime_type":"video/mp4","url":"https://cdn.example/video-only.mp4"}]}`)
	if got := findYouTubeMergedMediaURL(raw); got != "https://cdn.example/combined.mp4" {
		t.Fatalf("selected unusable stream: %s", got)
	}
	if got := findYouTubeMergedMediaURL(platformFixture(t, `{"adaptive_formats":[{"itag":137,"mime_type":"video/mp4","url":"https://cdn.example/video-only.mp4"}]}`)); got != "" {
		t.Fatalf("selected a separated stream: %s", got)
	}
}
