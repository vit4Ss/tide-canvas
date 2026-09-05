package social

import (
	"context"
	"math"
	"net/url"
	"strconv"
	"strings"
	"time"
)

// A bounded, public-data projection: retain meaningful platform-specific data
// without leaking raw cookies, access tokens, private flags or stream manifests.
type platformFieldVO struct {
	Key    string `json:"key"`
	Label  string `json:"label"`
	Value  string `json:"value"`
	Format string `json:"format,omitempty"`
}
type chapterVO struct {
	Title    string   `json:"title"`
	Start    *float64 `json:"start,omitempty"`
	Duration string   `json:"duration,omitempty"`
}
type platformDetailsVO struct {
	Fields    []platformFieldVO `json:"fields,omitempty"`
	Tags      []string          `json:"tags,omitempty"`
	Chapters  []chapterVO       `json:"chapters,omitempty"`
	Languages []string          `json:"languages,omitempty"`
}

// Follow named response wrappers only. Never walk recommendations, comments,
// music authors or arbitrary nested objects looking for a counter or identity.
func scopedObject(root any, wrappers []string, accept func(map[string]any) bool, depth int) map[string]any {
	if depth > 10 {
		return nil
	}
	if rows, ok := root.([]any); ok {
		for _, row := range rows {
			if found := scopedObject(row, wrappers, accept, depth+1); found != nil {
				return found
			}
		}
	}
	m, ok := root.(map[string]any)
	if !ok {
		return nil
	}
	if accept(m) {
		return m
	}
	for _, key := range wrappers {
		if found := scopedObject(directValue(m, key), wrappers, accept, depth+1); found != nil {
			return found
		}
	}
	return nil
}

func platformWorkRoot(p platform, root any) map[string]any {
	if p == platformBilibili {
		return bilibiliWorkRoot(root, 0)
	}
	return platformWorkObject(root, 0)
}

func platformWorkObject(root any, depth int) map[string]any {
	if root == nil || depth > 10 {
		return nil
	}
	if rows, ok := root.([]any); ok {
		for _, row := range rows {
			if found := platformWorkObject(row, depth+1); found != nil {
				return found
			}
		}
		return nil
	}
	m, ok := root.(map[string]any)
	if !ok {
		return nil
	}
	id := pathText(m, "aweme_id", "video_id", "note_id", "photo_id", "id")
	if id != "" && directString(m, "title", "desc", "caption", "display_title") != "" {
		return m
	}
	// Note cards may put the identity on the envelope and all fields inside.
	// Inherit only that identity, never fields belonging to another work.
	for _, key := range []string{"aweme_detail", "itemStruct", "item_info", "note_card", "note", "video_details", "videoDetail", "video_info", "photo", "detail"} {
		if child, ok := directValue(m, key).(map[string]any); ok {
			childID := pathText(child, "aweme_id", "video_id", "note_id", "photo_id", "id")
			if id != "" && childID != "" && childID != id {
				continue
			}
			if id != "" && childID == "" {
				copy := make(map[string]any, len(child)+1)
				for k, v := range child {
					copy[k] = v
				}
				copy["id"] = id
				child = copy
			}
			if found := platformWorkObject(child, depth+1); found != nil {
				return found
			}
		}
	}
	// A valid clip can have an empty caption. Use its own media/type evidence,
	// without accepting a bare generic id from an unrelated wrapper.
	mediaEvidence := directValue(m, "video") != nil || directValue(m, "image_post_info") != nil ||
		directValue(m, "mainMvUrls") != nil || directValue(m, "image_list") != nil || pathText(m, "media_url", "video_url") != ""
	if directString(m, "aweme_id", "video_id", "note_id", "photo_id") != "" || id != "" && (mediaEvidence || directString(m, "title", "desc", "caption", "display_title", "type", "photoType", "media_type") != "") {
		return m
	}
	for _, key := range []string{"data", "result", "aweme_details", "item_list", "note_list", "notes", "items", "photos", "feed"} {
		if found := platformWorkObject(directValue(m, key), depth+1); found != nil {
			return found
		}
	}
	return nil
}

func fieldValue(root any, path string) any {
	for _, key := range strings.Split(path, ".") {
		root = directValue(root, key)
	}
	return root
}
func pathText(root any, paths ...string) string {
	for _, path := range paths {
		if value := scalarString(fieldValue(root, path)); value != "" {
			return value
		}
	}
	return ""
}

func pathURL(root any, paths ...string) string {
	for _, path := range paths {
		if value := urlFromValue(fieldValue(root, path), 0); value != "" {
			return value
		}
	}
	return ""
}
func (d *platformDetailsVO) add(root any, key, label, format string, paths ...string) {
	value := truncateText(pathText(root, paths...), 600)
	if value == "" {
		return
	}
	if format == "count" {
		if n, err := strconv.ParseFloat(value, 64); err == nil && n < 0 {
			return
		}
	}
	for _, f := range d.Fields {
		if f.Key == key {
			return
		}
	}
	d.Fields = append(d.Fields, platformFieldVO{key, label, value, format})
}
func (d *platformDetailsVO) flag(root any, key, label, yes, no string, paths ...string) {
	for _, path := range paths {
		v := fieldValue(root, path)
		if v == nil {
			continue
		}
		var text string
		switch v {
		case true:
			text = yes
		case false:
			text = no
		}
		if text == "" {
			switch scalarString(v) {
			case "1", "true":
				text = yes
			case "0", "false":
				text = no
			}
		}
		if text != "" {
			d.Fields = append(d.Fields, platformFieldVO{key, label, text, ""})
			return
		}
	}
}
func appendUnique(values []string, value string, limit int) []string {
	value = truncateText(value, 120)
	if value == "" || len(values) >= limit {
		return values
	}
	for _, v := range values {
		if v == value {
			return values
		}
	}
	return append(values, value)
}
func tagValues(root any, paths ...string) []string {
	var result []string
	for _, path := range paths {
		v := fieldValue(root, path)
		rows, ok := v.([]any)
		if !ok {
			rows = []any{v}
		}
		for _, row := range rows {
			text := scalarString(row)
			if text == "" {
				text = pathText(row, "name", "tag_name", "cha_name", "hashtag_name", "title")
			}
			result = appendUnique(result, text, 40)
		}
	}
	return result
}

func normalizePlatformWork(p platform, root any, fallbackURL string) workVO {
	item := platformWorkRoot(p, root)
	if item == nil {
		return workVO{Platform: p}
	}
	var work workVO
	if p == platformBilibili {
		work = normalizeBilibiliWork(item, fallbackURL)
	}
	work.Platform = p
	if p == platformYouTube {
		// V2's video_url is the watch page, not a downloadable video stream.
		work.MediaURL = ""
		work.MediaURLs = nil
	}
	// Prefer item counters, not a nested author's lifetime statistics.
	metrics := []any{directValue(item, "statistics"), directValue(item, "stats"), directValue(item, "stat"), directValue(item, "interact_info"), directValue(item, "interaction"), item}
	metric := func(keys ...string) string { return truncateText(directString(metrics, keys...), 64) }
	if p != platformBilibili {
		work.CoverURL = pathURL(item, "cover", "cover_url", "coverUrls", "origin_cover", "thumbnail", "thumbnail_url", "thumbnails", "image_url", "pic", "video.cover", "video.origin_cover", "video.dynamic_cover")
		work.ImageURLs = workImageURLs(item, work.CoverURL, 40)
		if work.CoverURL == "" && len(work.ImageURLs) > 0 {
			work.CoverURL = work.ImageURLs[0]
		}
		work.PageURL = firstNonBlank(pathURL(item, "share_url", "web_url", "canonical_url", "page_url", "share_info.share_url"), fallbackURL)
		work.MediaType = ""
		work.ID = truncateText(pathText(item, "aweme_id", "note_id", "video_id", "photo_id", "id"), 256)
		work.Description = truncateText(pathText(item, "desc", "description", "content", "text", "caption"), 4000)
		work.Title = truncateText(firstNonBlank(pathText(item, "title", "display_title", "caption"), work.Description), 300)
		work.PublishedAt = truncateText(pathText(item, "create_time", "publish_time", "published_time", "published_at", "pubdate", "created", "timestamp", "publish_date", "upload_date", "time"), 128)
		work.Duration = normalizeDuration(pathText(item, "duration_text", "duration_string", "length_seconds", "video_duration", "length"), false)
		if work.Duration == "" {
			work.Duration = normalizeDuration(pathText(item, "video.duration", "duration"), p == platformDouyin || p == platformTikTok && directString(item, "aweme_id") != "" || p == platformKuaishou)
		}
		// A soundtrack or related clip is not the work's playable video.
		media := map[string]any{}
		for _, key := range []string{"video", "video_info", "play_addr", "play_addr_h264", "mainMvUrls", "video_url", "media_url", "playback_url", "download_addr", "master_url", "stream_url", "nwm_video_url"} {
			if v := directValue(item, key); v != nil {
				media[key] = v
			}
		}
		if p != platformYouTube {
			work.MediaURLs = findMediaURLs(media)
			work.MediaURL = ""
			if len(work.MediaURLs) > 0 {
				work.MediaURL = work.MediaURLs[0]
			}
		}
		work.Stats = metricVO{
			Play:     metric("play_count", "view_count", "view_count_text", "viewCountText", "views", "viewCount", "play"),
			Like:     metric("digg_count", "like_count", "liked_count", "like_count_text", "likes", "realLikeCount"),
			Comment:  metric("comment_count", "comments", "commentCount"),
			Share:    metric("share_count", "shared_count", "shareCount", "shares"),
			Favorite: metric("collect_count", "collected_count", "favorite_count", "collectionCount", "favorites"),
		}
	}
	if p == platformBilibili {
		work.Stats.Coin = metric("coin", "coin_count")
		work.Stats.Danmaku = metric("danmaku", "danmaku_count", "video_review")
	}
	if p == platformDouyin || p == platformTikTok {
		work.Stats.Download = metric("download_count")
	}
	d := &platformDetailsVO{}
	d.add(item, "contentId", "作品 ID", "", "bvid", "aweme_id", "note_id", "video_id", "photo_id", "id")
	d.add(item, "width", "画面宽度", "", "dimension.width", "video.width", "width")
	d.add(item, "height", "画面高度", "", "dimension.height", "video.height", "height")
	work.Title = truncateText(firstNonBlank(work.Title, pathText(item, "display_title")), 300)
	if value := pathText(item, "published_at", "publish_date", "upload_date", "time"); work.PublishedAt == "" {
		work.PublishedAt = value
	}
	if value := pathText(item, "length_seconds", "duration_string"); value != "" {
		work.Duration = normalizeDuration(value, false)
	}
	// Explicit content type wins over the presence of a cover image or BGM URL.
	kind := strings.ToLower(pathText(item, "type", "note_type", "media_type", "aweme_type", "photoType"))
	if kind == "normal" || kind == "image" || kind == "images" || kind == "68" || fieldValue(item, "image_post_info.images") != nil {
		work.MediaType = "image"
		work.MediaURL = ""
		work.MediaURLs = nil
		work.Duration = ""
		images := directValue(item, "image_list", "images", "pictures")
		if images == nil {
			images = fieldValue(item, "image_post_info.images")
		}
		work.ImageURLs = workImageURLs(map[string]any{"images": images}, work.CoverURL, 40)
		if len(work.ImageURLs) > 0 {
			work.CoverURL = work.ImageURLs[0]
		}
		d.add(map[string]any{"count": len(work.ImageURLs)}, "imageCount", "已获取图片", "count", "count")
	} else if kind == "video" || kind == "0" || p == platformYouTube || p == platformBilibili || directValue(item, "video") != nil || work.MediaURL != "" {
		work.MediaType = "video"
	}
	switch p {
	case platformBilibili:
		d.add(item, "category", "视频分区", "", "tname", "tname_v2")
		if copyright := pathText(item, "copyright"); copyright == "1" || copyright == "2" {
			label := "原创"
			if copyright == "2" {
				label = "转载"
			}
			d.Fields = append(d.Fields, platformFieldVO{Key: "original", Label: "创作类型", Value: label})
		}
		d.add(item, "parts", "分 P 数量", "count", "videos")
		d.add(item, "aid", "AV 号", "", "aid")
		d.Tags = tagValues(item, "tags", "tag")
		if rows, ok := directValue(item, "pages").([]any); ok {
			for _, row := range rows {
				if len(d.Chapters) == 100 {
					break
				}
				d.Chapters = append(d.Chapters, chapterVO{Title: truncateText(pathText(row, "part"), 200), Duration: normalizeDuration(pathText(row, "duration"), false)})
			}
		}
	case platformDouyin, platformTikTok:
		d.Tags = tagValues(item, "cha_list", "text_extra", "challenges", "hashtags")
		d.add(item, "music", "使用音乐", "", "music.title", "music.music_name")
		d.add(item, "musicAuthor", "音乐作者", "", "music.author", "music.author_name")
		d.flag(item, "originalMusic", "原声类型", "原创音乐", "引用音乐", "music.is_original")
		d.add(item, "location", "作品地点", "", "poi_info.poi_name", "location.name")
		d.add(item, "region", "发布地区", "", "region")
		d.add(item, "language", "作品语言", "", "desc_language", "text_language")
		d.flag(item, "pinned", "置顶作品", "是", "否", "is_top", "is_pinned_item", "isPinnedItem")
		if work.PageURL == "" && p == platformDouyin {
			work.PageURL = "https://www.douyin.com/video/" + url.PathEscape(work.ID)
		}
	case platformXiaohongshu:
		d.Tags = tagValues(item, "tag_list", "tags", "topics")
		d.add(item, "location", "笔记地点", "", "poi.name", "poi_info.name")
		d.add(item, "ipLocation", "公开 IP 属地", "", "ip_location")
		d.add(item, "updated", "更新时间", "", "last_update_time", "update_time")
		d.flag(item, "pinned", "置顶笔记", "是", "否", "is_top", "is_pinned")
		if work.PageURL == "" && work.ID != "" {
			work.PageURL = "https://www.xiaohongshu.com/explore/" + url.PathEscape(work.ID)
		}
	case platformYouTube:
		d.Tags = tagValues(item, "keywords", "tags", "categories")
		d.add(item, "language", "视频语言", "", "language", "default_audio_language")
		d.add(item, "availability", "可见范围", "", "availability")
		d.add(item, "liveStatus", "直播状态", "", "live_status")
		d.add(item, "captionCount", "字幕轨道", "count", "caption_count")
		d.add(item, "ageLimit", "年龄分级", "", "age_limit")
		if rows, ok := directValue(item, "chapters").([]any); ok {
			for _, row := range rows {
				if len(d.Chapters) == 100 {
					break
				}
				title := pathText(row, "title")
				start, err := strconv.ParseFloat(pathText(row, "start_time", "start"), 64)
				if title != "" && err == nil && !math.IsNaN(start) && !math.IsInf(start, 0) && start >= 0 {
					d.Chapters = append(d.Chapters, chapterVO{Title: truncateText(title, 200), Start: &start})
				}
			}
		}
		if rows, ok := directValue(item, "captions").([]any); ok {
			for _, row := range rows {
				d.Languages = appendUnique(d.Languages, pathText(row, "language", "language_code", "languageCode", "name"), 40)
			}
		}
		if work.PageURL == "" && work.ID != "" {
			work.PageURL = "https://www.youtube.com/watch?v=" + url.QueryEscape(work.ID)
		}
	case platformKuaishou:
		d.Tags = tagValues(item, "tags", "tag", "topics")
		d.add(item, "music", "配乐", "", "music.name", "music.title", "musicName")
		d.add(item, "location", "作品地点", "", "location", "poi.name", "cityName")
		d.flag(item, "pinned", "置顶作品", "是", "否", "top", "is_top")
	}
	// A merged media response can supplement ONLY the media URL, not counters.
	if work.MediaType == "video" && work.MediaURL == "" && p != platformBilibili {
		if p == platformYouTube {
			work.MediaURL = findYouTubeMergedMediaURL(root)
			if preferred := firstString(root, "preferred_media_url"); preferred != "" {
				work.MediaURL = archiveableMediaURL(preferred)
			}
		} else if p == platformXiaohongshu {
			if responses, ok := root.([]any); ok {
				for _, response := range responses {
					candidate := platformWorkRoot(p, response)
					if candidate != nil && pathText(candidate, "note_id", "id") == work.ID {
						// Normalize one response at a time: this also handles top-level
						// playback fields without searching soundtrack objects.
						work.MediaURL = normalizePlatformWork(p, candidate, "").MediaURL
						if work.MediaURL != "" {
							break
						}
					}
				}
			}
		}
		if work.MediaURL != "" {
			work.MediaURLs = []string{work.MediaURL}
		}
	}
	work.Details = d
	return work
}

func firstNonBlank(a, b string) string {
	if a != "" {
		return a
	}
	return b
}

func platformRows(root any, depth int) []any {
	if root == nil || depth > 10 {
		return nil
	}
	if rows, ok := root.([]any); ok {
		return rows
	}
	for _, key := range []string{"aweme_list", "item_list", "videos", "notes", "vlist", "archives", "photos", "works", "items", "feeds", "entries", "list", "data", "result"} {
		if rows := platformRows(directValue(root, key), depth+1); rows != nil {
			return rows
		}
	}
	return nil
}

func normalizePlatformWorks(p platform, root any) []workVO {
	rows := platformRows(root, 0)
	result := make([]workVO, 0, 12)
	seen := map[string]bool{}
	for _, row := range rows {
		work := normalizePlatformWork(p, row, "")
		id := firstNonBlank(work.ID, work.PageURL+"|"+work.Title)
		if id == "|" || seen[id] || !workHasData(work) {
			continue
		}
		seen[id] = true
		result = append(result, work)
		if len(result) == 12 {
			break
		}
	}
	return result
}

func profileObject(root any) map[string]any {
	return scopedObject(root, []string{"data", "result", "user", "user_info", "owner", "author", "author_info", "channel", "userProfile", "profile", "basic_info"}, func(m map[string]any) bool {
		return directString(m, "nickname", "nick_name", "name", "user_name", "display_name", "channel_name", "channel_title") != "" || directString(m, "title", "handle", "unique_id", "kwai_id") != "" && directString(m, "mid", "uid", "user_id", "id", "channel_id", "sec_uid") != ""
	}, 0)
}

func workAuthor(p platform, raw any) map[string]any {
	item := platformWorkRoot(p, raw)
	for _, key := range []string{"author", "owner", "user", "author_info", "user_info", "channel"} {
		if author := profileObject(directValue(item, key)); author != nil {
			return author
		}
	}
	if p == platformKuaishou && item != nil && pathText(item, "user_name", "owner_nickname") != "" {
		// Kuaishou can flatten creator identity into photo and return its
		// account counters in a sibling counts object. Do not use photo likes.
		envelope := raw
		for depth := 0; depth < 10; depth++ {
			if next := directValue(envelope, "data"); next != nil {
				envelope = next
			} else {
				break
			}
		}
		counts := directValue(envelope, "counts")
		return map[string]any{
			"user_id": pathText(item, "user_eid", "user_id"), "nickname": pathText(item, "user_name", "owner_nickname"),
			"avatar":          pathURL(item, "head_url", "user_avatar", "user_head_url"),
			"follower_count":  pathText(counts, "fan_count", "fans_count", "follower_count"),
			"following_count": pathText(counts, "follow_count", "following_count"), "photo_count": pathText(counts, "photo_count"),
		}
	}
	if p == platformYouTube && item != nil {
		// Some video-info responses flatten channel identity into the video.
		// Project channel fields explicitly so video descriptions/counters cannot leak in.
		return map[string]any{
			"channel_id": pathText(item, "channel_id", "uploader_id"), "channel_name": pathText(item, "channel_name", "channel", "author", "uploader"),
			"avatar": pathURL(item, "channel_avatar", "channel_thumbnail"), "page_url": pathURL(item, "channel_url", "uploader_url"),
			"follower_count": pathText(item, "channel_follower_count", "subscriber_count", "subscriber_count_text"),
		}
	}
	return nil
}

// Only the explicitly requested profile endpoint may contribute sibling stats.
// Never recurse through its works, recommendations, music or other identities.
func profileEnvelope(root any, depth int) []any {
	if root == nil || depth > 6 {
		return nil
	}
	if rows, ok := root.([]any); ok {
		var result []any
		for _, row := range rows {
			result = append(result, profileEnvelope(row, depth+1)...)
		}
		return result
	}
	result := []any{root, directValue(root, "stats"), directValue(root, "statistics")}
	for _, key := range []string{"data", "result", "user_info", "userProfile", "profile"} {
		result = append(result, profileEnvelope(directValue(root, key), depth+1)...)
	}
	return result
}

func platformProfile(p platform, root, works any, account bool) *profileVO {
	var item map[string]any
	if account {
		item = profileObject(root)
		if item == nil {
			for _, row := range platformRows(works, 0) {
				if item = workAuthor(p, row); item != nil {
					break
				}
			}
		}
	} else {
		item = workAuthor(p, root)
	}
	if item == nil {
		return nil
	}
	sources := []any{item, directValue(item, "stats"), directValue(item, "statistics")}
	if account {
		sources = append(sources, profileEnvelope(root, 0)...)
	}
	count := func(keys ...string) string { return truncateText(directString(sources, keys...), 64) }
	profile := &profileVO{
		ID:        truncateText(pathText(item, "mid", "uid", "user_id", "channel_id", "sec_uid", "user_eid", "id"), 256),
		Name:      truncateText(pathText(item, "nickname", "nick_name", "name", "user_name", "display_name", "channel_name", "channel_title", "title"), 200),
		Handle:    truncateText(pathText(item, "unique_id", "kwai_id", "handle", "short_id"), 200),
		AvatarURL: pathURL(item, "avatar_larger", "avatar_medium", "avatar", "face", "avatar_url", "avatar_thumb", "head_url", "profile_pic_url"),
		PageURL:   pathURL(item, "page_url", "channel_url", "profile_url", "share_info.share_url"),
		Bio:       truncateText(pathText(item, "signature", "bio", "channel_description", "description", "desc", "sign"), 2000),
		Followers: count("follower_count", "follower", "fans_count", "fan_count", "fans", "subscriber_count", "subscriber_count_text"),
		Following: count("following_count", "following", "follow_count"),
		Likes:     count("total_favorited", "liked_count", "likes"),
		Works:     count("aweme_count", "video_count", "photo_count", "notes_count", "archive_count"),
	}
	if profile.Name == "" && profile.Handle == "" && profile.AvatarURL == "" {
		return nil
	}
	d := &platformDetailsVO{}
	switch p {
	case platformBilibili:
		d.add(item, "level", "UP 主等级", "", "level", "level_info.current_level")
		d.add(item, "certification", "官方认证", "", "official.title", "official.desc")
		d.add(root, "totalViews", "投稿累计播放", "count", "archive.view")
		d.add(root, "articleViews", "专栏累计阅读", "count", "article.view")
	case platformXiaohongshu:
		// XHS reports combined likes + collections; never relabel it as likes.
		for _, row := range asRows(fieldValue(root, "data.interactions"), fieldValue(root, "interactions"), fieldValue(item, "interactions")) {
			n := pathText(row, "count")
			switch pathText(row, "type") {
			case "fans":
				profile.Followers = n
			case "follows":
				profile.Following = n
			case "interaction":
				d.add(map[string]any{"count": n}, "likesAndCollects", "获赞与收藏", "count", "count")
			}
		}
		d.add(item, "redId", "小红书号", "", "red_id", "redId", "red_number")
		d.add(item, "ipLocation", "公开 IP 属地", "", "ip_location", "ipLocation")
		d.add(item, "certification", "认证信息", "", "official_verify_info", "verify_info")
	case platformDouyin, platformTikTok:
		d.add(item, "shortId", "抖音号 / 用户名", "", "unique_id", "short_id")
		d.add(item, "certification", "认证信息", "", "custom_verify", "enterprise_verify_reason")
		d.flag(item, "verified", "认证账号", "已认证", "未认证", "verified", "is_verified")
		d.add(item, "region", "公开地区", "", "region", "country")
		d.add(item, "language", "账号语言", "", "language")
	case platformYouTube:
		d.add(item, "totalViews", "频道累计观看", "count", "view_count", "view_count_text", "total_views", "stats.viewCount")
		d.add(item, "joined", "加入时间", "", "joined_date", "joinedDate", "joined_date_text", "published_at")
		d.add(item, "country", "频道地区", "", "country", "country_name")
		d.flag(item, "verified", "频道认证", "已认证", "未认证", "is_verified", "channel_is_verified")
		d.Tags = tagValues(item, "keywords", "tags")
	case platformKuaishou:
		d.add(item, "kwaiId", "快手号", "", "kwai_id", "kwaiId")
		d.add(item, "certification", "认证信息", "", "verifiedDetail", "verified_detail", "verifiedReason")
		d.add(item, "city", "公开地区", "", "city_name", "cityName", "city")
	}
	profile.Details = d
	return profile
}

func asRows(values ...any) []any {
	for _, v := range values {
		if rows, ok := v.([]any); ok {
			return rows
		}
	}
	return nil
}

func mergeWorkDetails(detail, old *platformDetailsVO) *platformDetailsVO {
	if detail == nil {
		return old
	}
	if old == nil {
		return detail
	}
	for _, field := range old.Fields {
		exists := false
		for _, current := range detail.Fields {
			if current.Key == field.Key {
				exists = true
				break
			}
		}
		if !exists {
			detail.Fields = append(detail.Fields, field)
		}
	}
	for _, tag := range old.Tags {
		detail.Tags = appendUnique(detail.Tags, tag, 40)
	}
	for _, language := range old.Languages {
		detail.Languages = appendUnique(detail.Languages, language, 40)
	}
	if len(detail.Chapters) == 0 {
		detail.Chapters = old.Chapters
	}
	return detail
}

func mergeWork(detail, old workVO) workVO {
	detail.Title = firstNonBlank(detail.Title, old.Title)
	detail.Description = firstNonBlank(detail.Description, old.Description)
	detail.CoverURL = firstNonBlank(detail.CoverURL, old.CoverURL)
	detail.PageURL = firstNonBlank(detail.PageURL, old.PageURL)
	detail.PublishedAt = firstNonBlank(detail.PublishedAt, old.PublishedAt)
	detail.Duration = firstNonBlank(detail.Duration, old.Duration)
	detail.MediaType = firstNonBlank(detail.MediaType, old.MediaType)
	if detail.MediaType != "image" {
		if detail.MediaURL == "" {
			detail.MediaURL, detail.MediaURLs = old.MediaURL, old.MediaURLs
		}
	} else {
		detail.MediaURL, detail.MediaURLs, detail.Duration = "", nil, ""
	}
	if len(detail.ImageURLs) == 0 || len(detail.ImageURLs) == 1 && detail.ImageURLs[0] == detail.CoverURL && len(old.ImageURLs) > 1 {
		detail.ImageURLs = old.ImageURLs
	}
	detail.Stats.Play = firstNonBlank(detail.Stats.Play, old.Stats.Play)
	detail.Stats.Like = firstNonBlank(detail.Stats.Like, old.Stats.Like)
	detail.Stats.Comment = firstNonBlank(detail.Stats.Comment, old.Stats.Comment)
	detail.Stats.Share = firstNonBlank(detail.Stats.Share, old.Stats.Share)
	detail.Stats.Favorite = firstNonBlank(detail.Stats.Favorite, old.Stats.Favorite)
	detail.Stats.Coin = firstNonBlank(detail.Stats.Coin, old.Stats.Coin)
	detail.Stats.Danmaku = firstNonBlank(detail.Stats.Danmaku, old.Stats.Danmaku)
	detail.Stats.Download = firstNonBlank(detail.Stats.Download, old.Stats.Download)
	detail.Details = mergeWorkDetails(detail.Details, old.Details)
	if detail.MediaType == "image" && detail.Details != nil && len(detail.ImageURLs) > 0 {
		for i := range detail.Details.Fields {
			if detail.Details.Fields[i].Key == "imageCount" {
				detail.Details.Fields[i].Value = strconv.Itoa(len(detail.ImageURLs))
			}
		}
	}
	return detail
}

// List endpoints often omit detailed counters. Enrich only the twelve displayed
// samples, in batches of three, within one shared 18-second budget. Failure
// preserves list data; loading a saved snapshot never enters this code path.
func (h *handler) enrichAccountWorks(ctx context.Context, cfg settings, p platform, works []workVO) int {
	if p != platformBilibili && p != platformXiaohongshu && p != platformYouTube {
		return 0
	}
	ctx, cancel := context.WithTimeout(ctx, 18*time.Second)
	defer cancel()
	var calls []upstreamCall
	var indexes []int
	for i, work := range works[:min(12, len(works))] {
		if work.ID == "" {
			continue
		}
		complete := work.Stats.Like != "" && work.Stats.Comment != ""
		if p == platformBilibili {
			complete = complete && !missingBilibiliMetrics(work)
		} else if p == platformXiaohongshu {
			complete = complete && work.Stats.Favorite != "" && work.Stats.Share != ""
		}
		if complete {
			continue
		}
		var call upstreamCall
		switch p {
		case platformBilibili:
			if !bilibiliBVIDPattern.MatchString(work.ID) {
				continue
			}
			call = upstreamCall{"/api/v1/bilibili/web/fetch_one_video", url.Values{"bv_id": {work.ID}}}
		case platformXiaohongshu:
			call = upstreamCall{"/api/v1/xiaohongshu/app_v2/get_image_note_detail", url.Values{"note_id": {work.ID}}}
		case platformYouTube:
			call = upstreamCall{"/api/v1/youtube/web_v2/get_video_info_v2", url.Values{"video_id": {work.ID}, "need_format": {"true"}}}
		}
		calls = append(calls, call)
		indexes = append(indexes, i)
	}
	missing := 0
	for start := 0; start < len(calls); start += 3 {
		if ctx.Err() != nil {
			missing += len(calls) - start
			break
		}
		end := min(start+3, len(calls))
		data, errs := h.tikhubMany(ctx, cfg, calls[start:end])
		for j, raw := range data {
			i := indexes[start+j]
			if errs[j] != nil {
				missing++
				continue
			}
			detail := normalizePlatformWork(p, raw, works[i].PageURL)
			if detail.ID != works[i].ID {
				missing++
				continue
			}
			works[i] = mergeWork(detail, works[i])
		}
	}
	return missing
}
