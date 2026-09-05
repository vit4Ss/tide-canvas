package social

import (
	"context"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"
)

var bilibiliBVIDPattern = regexp.MustCompile(`^BV[0-9A-Za-z]{10}$`)

// Only unwrap the detail response itself. Recursive searches through all keys
// can borrow a related video's counters, a commenter's name, or a DASH segment.
func bilibiliWorkRoot(root any, depth int) map[string]any {
	if depth > normalizeDepthLimit {
		return nil
	}
	item, ok := root.(map[string]any)
	if !ok {
		return nil
	}
	if directString(item, "bvid") != "" || (directString(item, "aid") != "" && directString(item, "title") != "") {
		return item
	}
	for _, key := range []string{"data", "View", "videoData", "video_info", "video_detail", "result"} {
		if found := bilibiliWorkRoot(directValue(item, key), depth+1); found != nil {
			return found
		}
	}
	return nil
}

func normalizeBilibiliWork(item map[string]any, sourceURL string) workVO {
	bvid := directString(item, "bvid")
	identity := bvid
	if identity == "" {
		identity = directString(item, "aid")
	}
	pageURL := sourceURL
	if pageURL == "" && bvid != "" {
		pageURL = "https://www.bilibili.com/video/" + url.PathEscape(bvid)
	}
	cover := bilibiliURL(directString(item, "pic", "cover", "cover_url"))
	images := []string{}
	if cover != "" {
		images = append(images, cover)
	}
	stat := directValue(item, "stat")
	metric := func(key string, aliases ...string) string {
		value := directString(stat, key)
		if value == "" {
			value = directString(item, aliases...)
		}
		// Missing and explicit zero have different meanings in the UI.
		return truncateText(value, 64)
	}
	media := bilibiliMediaURLs(item, 0)
	work := workVO{
		ID: truncateText(identity, 256), Title: truncateText(directString(item, "title"), 300),
		Description: truncateText(directString(item, "desc", "description", "dynamic"), 4000),
		CoverURL:    cover, ImageURLs: images, MediaURLs: media, MediaType: "video", PageURL: pageURL,
		Duration:    normalizeDuration(directString(item, "duration", "length"), false),
		PublishedAt: truncateText(directString(item, "pubdate", "created", "ctime"), 128),
		Stats: metricVO{
			Play: metric("view", "play", "view", "view_count"), Like: metric("like", "like", "likes", "like_count"),
			Comment:  metric("reply", "comment", "reply", "review", "comment_count"),
			Share:    metric("share", "share", "shares", "share_count"),
			Favorite: metric("favorite", "favorite", "favorites", "favorite_count"),
			Coin:     metric("coin", "coin", "coin_count"), Danmaku: metric("danmaku", "danmaku", "video_review"),
		},
	}
	if len(media) > 0 {
		work.MediaURL = media[0]
	}
	return work
}

func bilibiliURL(raw string) string {
	if strings.HasPrefix(raw, "//") {
		raw = "https:" + raw
	}
	return validHTTPURL(raw)
}

// durl contains sequential segments, not quality alternatives. Only a single
// progressive MP4 can be archived as a complete video by the current pipeline.
// Never feed DASH's separate video/audio or the first FLV segment to analysis.
func bilibiliMediaURLs(root any, depth int) []string {
	if depth > normalizeDepthLimit {
		return nil
	}
	item, ok := root.(map[string]any)
	if !ok {
		return nil
	}
	collect := func(values ...any) []string {
		result := []string{}
		seen := map[string]bool{}
		for _, value := range values {
			for _, raw := range urlsFromValue(value, 5) {
				u, _ := url.Parse(raw)
				if u == nil || !strings.HasSuffix(strings.ToLower(u.Path), ".mp4") || seen[raw] {
					continue
				}
				seen[raw] = true
				result = append(result, raw)
				if len(result) == 5 {
					return result
				}
			}
		}
		return result
	}
	if rows, ok := directValue(item, "durl").([]any); ok && len(rows) == 1 {
		if candidates := collect(directValue(rows[0], "url"), directValue(rows[0], "backup_url")); len(candidates) > 0 {
			return candidates
		}
	}
	for _, key := range []string{"video_url", "media_url", "mp4_url", "download_url", "play_url", "nwm_video_url"} {
		if candidates := collect(directValue(item, key)); len(candidates) > 0 {
			return candidates
		}
	}
	for _, key := range []string{"data", "result", "play_info", "playurl", "video_info", "video_data"} {
		if candidates := bilibiliMediaURLs(directValue(item, key), depth+1); len(candidates) > 0 {
			return candidates
		}
	}
	return nil
}

func bilibiliProfile(item map[string]any) *profileVO {
	// Do not let video statistics or related authors become account statistics.
	owner := directValue(item, "owner", "author")
	profile := platformProfile(platformBilibili, owner, nil, true)
	if profile != nil && profile.AvatarURL == "" {
		profile.AvatarURL = bilibiliURL(directString(owner, "face", "avatar"))
	}
	return profile
}

func missingBilibiliMetrics(work workVO) bool {
	return work.Stats.Play == "" || work.Stats.Like == "" || work.Stats.Comment == "" || work.Stats.Share == "" || work.Stats.Favorite == "" || work.Stats.Coin == "" || work.Stats.Danmaku == ""
}

func bilibiliCID(item map[string]any, source *url.URL) string {
	page := 1
	if value := source.Query().Get("p"); value != "" {
		n, err := strconv.Atoi(value)
		if err != nil || n < 1 {
			return ""
		}
		page = n
	}
	if rows, ok := directValue(item, "pages").([]any); ok {
		for _, row := range rows {
			if directString(row, "page") == strconv.Itoa(page) {
				return directString(row, "cid")
			}
		}
	}
	if page == 1 {
		return directString(item, "cid")
	}
	return ""
}

func (h *handler) inspectBilibiliContent(ctx context.Context, cfg settings, source *url.URL) (*inspectVO, error) {
	// Enrichment has a finite budget, including all fallbacks.
	ctx, cancel := context.WithTimeout(ctx, 55*time.Second)
	defer cancel()
	sourceURL := source.String()
	selectedPage := 1
	if raw := source.Query().Get("p"); raw != "" {
		page, err := strconv.Atoi(raw)
		if err != nil || page < 1 {
			return nil, &upstreamError{message: "哔哩哔哩视频分 P 参数无效"}
		}
		selectedPage = page
	}
	warnings := []string{}
	bvid := pathSegmentAfter(source, "video")
	if !bilibiliBVIDPattern.MatchString(bvid) {
		bvid = ""
	}
	data, initialErr := h.tikhubGet(ctx, cfg, "/api/v1/bilibili/web/fetch_one_video_v3", url.Values{"url": {sourceURL}})
	item := bilibiliWorkRoot(data, 0)
	if actual := directString(item, "bvid"); bvid != "" && actual != "" && actual != bvid {
		item = nil
	}
	if item != nil && bvid == "" {
		bvid = directString(item, "bvid")
	}
	work := normalizePlatformWork(platformBilibili, item, sourceURL)
	profile := bilibiliProfile(item)
	if bilibiliBVIDPattern.MatchString(bvid) && (item == nil || missingBilibiliMetrics(work) || profile == nil || profile.Name == "" || profile.AvatarURL == "") && ctx.Err() == nil {
		detail, detailErr := h.tikhubGet(ctx, cfg, "/api/v1/bilibili/web/fetch_one_video", url.Values{"bv_id": {bvid}})
		if full := bilibiliWorkRoot(detail, 0); detailErr == nil && full != nil && directString(full, "bvid") == bvid {
			// Preserve fields omitted by an alternative version, including explicit
			// zero counters; never merge a different BV's data into this work.
			merged := map[string]any{}
			for key, value := range item {
				merged[key] = value
			}
			for key, value := range full {
				if value != nil && value != "" {
					merged[key] = value
				}
			}
			stats := map[string]any{}
			for _, origin := range []any{directValue(item, "stat"), directValue(full, "stat")} {
				if values, ok := origin.(map[string]any); ok {
					for key, value := range values {
						if scalarString(value) != "" {
							stats[key] = value
						}
					}
				}
			}
			merged["stat"] = stats
			item = merged
			work = normalizePlatformWork(platformBilibili, item, sourceURL)
			profile = bilibiliProfile(item)
		}
	}
	if item == nil || !workHasData(work) {
		if initialErr != nil {
			return nil, initialErr
		}
		return nil, &upstreamError{message: "哔哩哔哩未返回可识别的视频详情，请确认作品链接公开且有效"}
	}
	if missingBilibiliMetrics(work) {
		warnings = append(warnings, "哔哩哔哩部分互动指标暂未返回，已保留获取到的数据；缺失项显示为 —")
	}
	media := work.MediaURLs
	cid := bilibiliCID(item, source)
	if rows, ok := directValue(item, "pages").([]any); ok && cid != "" {
		for _, row := range rows {
			if directString(row, "cid") == cid {
				if duration := directString(row, "duration"); duration != "" {
					work.Duration = normalizeDuration(duration, false)
				}
				break
			}
		}
	}
	// A detail response may carry the first part's stream even for ?p=2.
	// Select other parts explicitly by CID, never silently use part one.
	if selectedPage > 1 {
		media = nil
		work.MediaURL = ""
	}
	if len(media) == 0 && selectedPage == 1 && ctx.Err() == nil {
		play, _ := h.tikhubGet(ctx, cfg, "/api/v1/bilibili/web/fetch_video_play_info", url.Values{"url": {sourceURL}})
		media = bilibiliMediaURLs(play, 0)
	}
	if len(media) == 0 && cid != "" && bilibiliBVIDPattern.MatchString(bvid) && ctx.Err() == nil {
		play, _ := h.tikhubGet(ctx, cfg, "/api/v1/bilibili/web/fetch_video_playurl", url.Values{"bv_id": {bvid}, "cid": {cid}})
		media = bilibiliMediaURLs(play, 0)
	}
	work.MediaURLs = media
	if len(media) > 0 {
		work.MediaURL = media[0]
	} else {
		warnings = append(warnings, "已读取作品数据，但播放接口暂未提供可归档的完整 MP4；分离音视频或分段流不能直接用于 AI 视频分析")
	}
	return &inspectVO{Profile: profile, Content: &work, Works: []workVO{}, Warnings: warnings}, nil
}
