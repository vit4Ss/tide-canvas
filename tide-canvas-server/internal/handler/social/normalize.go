package social

import (
	"fmt"
	"net/netip"
	"net/url"
	"strconv"
	"strings"
	"unicode/utf8"
)

const normalizeDepthLimit = 14

var blockedMediaIPPrefixes = [...]netip.Prefix{
	netip.MustParsePrefix("100.64.0.0/10"),
	netip.MustParsePrefix("198.18.0.0/15"),
}

func normalizeKey(value string) string {
	value = strings.ToLower(value)
	return strings.NewReplacer("_", "", "-", "", ".", "").Replace(value)
}

func findKey(root any, wanted string, depth int) (any, bool) {
	if depth > normalizeDepthLimit || root == nil {
		return nil, false
	}
	key := normalizeKey(wanted)
	switch typed := root.(type) {
	case map[string]any:
		for current, value := range typed {
			if normalizeKey(current) == key {
				return value, true
			}
		}
		for _, value := range typed {
			if found, ok := findKey(value, wanted, depth+1); ok {
				return found, true
			}
		}
	case []any:
		for _, value := range typed {
			if found, ok := findKey(value, wanted, depth+1); ok {
				return found, true
			}
		}
	}
	return nil, false
}

func firstValue(root any, keys ...string) any {
	for _, key := range keys {
		if value, ok := findKey(root, key, 0); ok {
			return value
		}
	}
	return nil
}

func directString(root any, keys ...string) string {
	if rows, ok := root.([]any); ok {
		for _, row := range rows {
			if text := directString(row, keys...); text != "" {
				return text
			}
		}
		return ""
	}
	values, ok := root.(map[string]any)
	if !ok {
		return ""
	}
	for _, wanted := range keys {
		for key, value := range values {
			if normalizeKey(key) == normalizeKey(wanted) {
				if text := scalarString(value); text != "" {
					return text
				}
			}
		}
	}
	return ""
}

func scalarString(value any) string {
	switch typed := value.(type) {
	case string:
		return strings.TrimSpace(typed)
	case float64:
		if typed == float64(int64(typed)) {
			return strconv.FormatInt(int64(typed), 10)
		}
		return strconv.FormatFloat(typed, 'f', -1, 64)
	case float32:
		return strconv.FormatFloat(float64(typed), 'f', -1, 32)
	case int:
		return strconv.Itoa(typed)
	case int64:
		return strconv.FormatInt(typed, 10)
	case fmt.Stringer:
		return strings.TrimSpace(typed.String())
	default:
		return ""
	}
}

func firstString(root any, keys ...string) string {
	for _, key := range keys {
		if value, ok := findKey(root, key, 0); ok {
			if text := scalarString(value); text != "" {
				return text
			}
		}
	}
	return ""
}

func validHTTPURL(raw string) string {
	parsed, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || (parsed.Scheme != "https" && parsed.Scheme != "http") || parsed.Hostname() == "" {
		return ""
	}
	host := strings.ToLower(strings.TrimSuffix(parsed.Hostname(), "."))
	if host == "localhost" {
		return ""
	}
	if ip, err := netip.ParseAddr(host); err == nil {
		ip = ip.Unmap()
		if !ip.IsGlobalUnicast() || ip.IsPrivate() || ip.IsLoopback() || ip.IsLinkLocalUnicast() {
			return ""
		}
		for _, prefix := range blockedMediaIPPrefixes {
			if prefix.Contains(ip) {
				return ""
			}
		}
	}
	value := parsed.String()
	if len(value) > 8192 {
		return ""
	}
	return value
}

func archiveableMediaURL(raw string) string {
	value := validHTTPURL(raw)
	if value == "" {
		return ""
	}
	parsed, _ := url.Parse(value)
	lower := strings.ToLower(parsed.EscapedPath() + "?" + parsed.RawQuery)
	if strings.Contains(lower, ".m3u8") || strings.Contains(lower, ".mpd") || strings.Contains(lower, "format=m3u8") || strings.Contains(lower, "format=mpd") || strings.Contains(lower, "mpegurl") || strings.Contains(lower, "mime_type=audio") || strings.Contains(lower, "content_type=audio") {
		return ""
	}
	for _, audioExt := range []string{".mp3", ".m4a", ".aac", ".wav", ".flac", ".ogg", ".opus"} {
		if strings.HasSuffix(strings.ToLower(parsed.EscapedPath()), audioExt) {
			return ""
		}
	}
	return value
}

func truncateText(value string, maxRunes int) string {
	value = strings.TrimSpace(value)
	if maxRunes <= 0 || utf8.RuneCountInString(value) <= maxRunes {
		return value
	}
	runes := []rune(value)
	return strings.TrimSpace(string(runes[:maxRunes])) + "…"
}

func urlFromValue(value any, depth int) string {
	if depth > normalizeDepthLimit || value == nil {
		return ""
	}
	if raw := scalarString(value); raw != "" {
		return validHTTPURL(raw)
	}
	switch typed := value.(type) {
	case []any:
		for _, entry := range typed {
			if found := urlFromValue(entry, depth+1); found != "" {
				return found
			}
		}
	case map[string]any:
		for _, key := range []string{"url", "uri", "src", "url_list", "urlList", "download_url", "play_url"} {
			if nested, exists := typed[key]; exists {
				if found := urlFromValue(nested, depth+1); found != "" {
					return found
				}
			}
		}
		for _, nested := range typed {
			if found := urlFromValue(nested, depth+1); found != "" {
				return found
			}
		}
	}
	return ""
}

func firstURL(root any, keys ...string) string {
	for _, key := range keys {
		if value, ok := findKey(root, key, 0); ok {
			if found := urlFromValue(value, 0); found != "" {
				return found
			}
		}
	}
	return ""
}

func urlsFromValue(value any, limit int) []string {
	seen := map[string]bool{}
	result := []string{}
	var walk func(any, int)
	walk = func(current any, depth int) {
		if current == nil || depth > normalizeDepthLimit || len(result) >= limit {
			return
		}
		if raw := scalarString(current); raw != "" {
			if candidate := archiveableMediaURL(raw); candidate != "" && !seen[candidate] {
				seen[candidate] = true
				result = append(result, candidate)
			}
			return
		}
		switch typed := current.(type) {
		case []any:
			for _, entry := range typed {
				walk(entry, depth+1)
			}
		case map[string]any:
			for _, key := range []string{"url", "uri", "src", "url_list", "urlList", "download_url", "play_url"} {
				if nested, exists := typed[key]; exists {
					walk(nested, depth+1)
				}
			}
		}
	}
	walk(value, 0)
	return result
}

func findMediaURLs(root any) []string {
	for _, key := range []string{
		"preferred_media_url",
		"play_addr_h264", "playAddrH264", "play_addr_265", "play_addr", "playAddr",
		"mainMvUrls", "main_mv_urls", "video_url", "videoUrl", "media_url", "mediaUrl",
		"playback_url", "playbackUrl", "download_addr", "downloadAddr",
		"master_url", "masterUrl", "stream_url", "streamUrl", "nwm_video_url", "wmplay", "nowm",
		"h264", "h265", "video_streams", "formats", "bitrateInfo",
	} {
		if value, ok := findKey(root, key, 0); ok {
			if candidates := urlsFromValue(value, 5); len(candidates) > 0 {
				return candidates
			}
		}
	}
	if candidate := findVideoLikeURL(root, 0); candidate != "" {
		return []string{candidate}
	}
	return []string{}
}

func findMediaURL(root any) string {
	candidates := findMediaURLs(root)
	if len(candidates) == 0 {
		return ""
	}
	return candidates[0]
}

func findYouTubeMergedMediaURL(root any) string {
	formats := firstValue(root, "formats")
	rows, ok := formats.([]any)
	if !ok || len(rows) == 0 {
		return ""
	}
	type candidate struct {
		url    string
		itag   string
		height int
	}
	candidates := make([]candidate, 0, len(rows))
	for _, row := range rows {
		item, ok := row.(map[string]any)
		if !ok {
			continue
		}
		mimeType := strings.ToLower(firstString(item, "mime_type", "mimeType"))
		if mimeType != "" && !strings.Contains(mimeType, "video") {
			continue
		}
		mediaURL := archiveableMediaURL(urlFromValue(item["url"], 0))
		if mediaURL == "" {
			continue
		}
		height, _ := strconv.Atoi(firstString(item, "height"))
		candidates = append(candidates, candidate{url: mediaURL, itag: firstString(item, "itag"), height: height})
	}
	for _, item := range candidates {
		if item.itag == "18" {
			return item.url
		}
	}
	bestIndex, bestHeight := -1, -1
	for index, item := range candidates {
		if item.height > 0 && item.height <= 480 && item.height > bestHeight {
			bestIndex, bestHeight = index, item.height
		}
	}
	if bestIndex >= 0 {
		return candidates[bestIndex].url
	}
	if len(candidates) > 0 {
		return candidates[0].url
	}
	return ""
}

func findVideoLikeURL(root any, depth int) string {
	if depth > normalizeDepthLimit || root == nil {
		return ""
	}
	switch typed := root.(type) {
	case string:
		candidate := archiveableMediaURL(typed)
		if candidate != "" {
			parsed, _ := url.Parse(candidate)
			lowerPath := strings.ToLower(parsed.EscapedPath())
			if strings.HasSuffix(lowerPath, ".mp4") || strings.HasSuffix(lowerPath, ".mov") || strings.HasSuffix(lowerPath, ".webm") || strings.HasSuffix(lowerPath, ".mkv") {
				return candidate
			}
		}
	case map[string]any:
		kind := strings.ToLower(firstNonEmptyString(typed, "mime_type", "mimeType", "content_type", "format", "type"))
		if strings.Contains(kind, "video") || strings.Contains(kind, "mp4") || strings.Contains(kind, "mpegurl") {
			for _, key := range []string{"url", "src", "uri"} {
				if candidate := archiveableMediaURL(urlFromValue(typed[key], 0)); candidate != "" {
					return candidate
				}
			}
		}
		for _, value := range typed {
			if found := findVideoLikeURL(value, depth+1); found != "" {
				return found
			}
		}
	case []any:
		for _, value := range typed {
			if found := findVideoLikeURL(value, depth+1); found != "" {
				return found
			}
		}
	}
	return ""
}

func collectImageURLs(root any, limit int) []string {
	seen := map[string]bool{}
	result := []string{}
	var walk func(any, int)
	walk = func(value any, depth int) {
		if depth > normalizeDepthLimit || len(result) >= limit || value == nil {
			return
		}
		switch typed := value.(type) {
		case map[string]any:
			for key, nested := range typed {
				normalized := normalizeKey(key)
				if strings.Contains(normalized, "image") || strings.Contains(normalized, "cover") || strings.Contains(normalized, "thumbnail") {
					if candidate := urlFromValue(nested, 0); candidate != "" && !seen[candidate] {
						seen[candidate] = true
						result = append(result, candidate)
					}
				}
				walk(nested, depth+1)
			}
		case []any:
			for _, nested := range typed {
				walk(nested, depth+1)
			}
		}
	}
	walk(root, 0)
	return result
}

func isVideoTree(root any) bool {
	value := strings.ToLower(firstString(root, "media_type", "mediaType", "note_type", "noteType", "type", "aweme_type"))
	return strings.Contains(value, "video") || value == "0" || findMediaURL(root) != ""
}

func primaryWorkRoot(root any) any {
	for _, key := range []string{
		"aweme_detail", "aweme_details", "itemStruct", "item_info", "note_card",
		"video_details", "videoDetail", "photo", "note", "video_info",
	} {
		value := firstValue(root, key)
		switch typed := value.(type) {
		case map[string]any:
			return typed
		case []any:
			for _, entry := range typed {
				if item, ok := entry.(map[string]any); ok {
					return item
				}
			}
		}
	}
	return root
}

func normalizeWork(root any, fallbackPageURL string) workVO {
	itemRoot := primaryWorkRoot(root)
	description := firstString(itemRoot, "desc", "description", "content", "text", "dynamic", "caption")
	title := firstString(itemRoot, "title", "caption", "name")
	if title == "" {
		title = description
	}
	mediaURLs := findMediaURLs(root)
	mediaURL := ""
	if len(mediaURLs) > 0 {
		mediaURL = mediaURLs[0]
	}
	coverURL := firstURL(itemRoot, "cover", "cover_url", "coverUrl", "coverUrls", "origin_cover", "dynamic_cover", "thumbnail", "thumbnail_url", "image_url", "imageUrl")
	if coverURL == "" {
		if images := collectImageURLs(root, 1); len(images) > 0 {
			coverURL = images[0]
		}
	}
	mediaType := strings.ToLower(firstString(itemRoot, "media_type", "mediaType", "note_type", "noteType", "photoType", "type"))
	if mediaURL != "" {
		mediaType = "video"
	} else if mediaType == "" && coverURL != "" {
		mediaType = "image"
	}
	pageURL := firstURL(itemRoot, "share_url", "shareUrl", "web_url", "webUrl", "canonical_url", "canonicalUrl", "page_url", "pageUrl")
	if pageURL == "" && firstString(itemRoot, "video_id", "videoId") != "" {
		pageURL = firstURL(itemRoot, "url")
	}
	if pageURL == "" {
		pageURL = fallbackPageURL
	}
	duration := firstString(itemRoot, "duration_text", "durationText")
	if duration != "" {
		duration = normalizeDuration(duration, false)
	} else if videoRoot := firstValue(itemRoot, "video"); videoRoot != nil {
		duration = normalizeDuration(scalarString(firstValue(videoRoot, "duration")), firstString(itemRoot, "aweme_id", "awemeId") != "")
	}
	if duration == "" {
		shortVideoMilliseconds := firstString(itemRoot, "aweme_id", "awemeId", "photo_id", "photoId") != ""
		duration = normalizeDuration(firstString(itemRoot, "duration"), shortVideoMilliseconds)
	}
	if duration == "" {
		duration = normalizeDuration(firstString(itemRoot, "video_duration"), false)
	}
	workID := firstString(itemRoot, "aweme_id", "awemeId", "video_id", "videoId", "note_id", "noteId", "photo_id", "photoId", "bvid")
	if workID == "" {
		workID = directString(itemRoot, "id")
	}
	return workVO{
		ID:          truncateText(workID, 256),
		Title:       truncateText(title, 300),
		Description: truncateText(description, 4000),
		CoverURL:    coverURL,
		MediaURL:    mediaURL,
		MediaURLs:   mediaURLs,
		PageURL:     pageURL,
		MediaType:   truncateText(mediaType, 64),
		Duration:    truncateText(duration, 64),
		PublishedAt: truncateText(firstString(itemRoot, "create_time", "createTime", "publish_time", "publishTime", "published_time", "publishedAt", "pubdate", "timestamp"), 128),
		Stats: metricVO{
			Play:     truncateText(firstString(itemRoot, "play_count", "playCount", "view_count", "viewCount", "views", "view"), 64),
			Like:     truncateText(firstString(itemRoot, "digg_count", "diggCount", "like_count", "likeCount", "liked_count", "likes"), 64),
			Comment:  truncateText(firstString(itemRoot, "comment_count", "commentCount", "comments"), 64),
			Share:    truncateText(firstString(itemRoot, "share_count", "shareCount", "shares"), 64),
			Favorite: truncateText(firstString(itemRoot, "collect_count", "collectCount", "favorite_count", "favoriteCount", "collectionCount", "favorites"), 64),
		},
	}
}

func workHasData(work workVO) bool {
	return work.ID != "" || work.Title != "" || work.Description != "" || work.CoverURL != "" || work.MediaURL != ""
}

func normalizeDuration(raw string, milliseconds bool) string {
	raw = strings.TrimSpace(raw)
	if raw == "" || strings.Contains(raw, ":") || strings.ContainsAny(strings.ToLower(raw), "hms时分秒") {
		return raw
	}
	value, err := strconv.ParseFloat(raw, 64)
	if err != nil || value <= 0 {
		return raw
	}
	if milliseconds {
		value /= 1000
	}
	seconds := int(value + .5)
	if seconds >= 3600 {
		return fmt.Sprintf("%d:%02d:%02d", seconds/3600, seconds%3600/60, seconds%60)
	}
	return fmt.Sprintf("%02d:%02d", seconds/60, seconds%60)
}

func findList(root any) []any {
	for _, key := range []string{"aweme_list", "awemeList", "item_list", "itemList", "videos", "notes", "vlist", "archives", "works", "items", "feeds", "list"} {
		if value, ok := findKey(root, key, 0); ok {
			if rows, ok := value.([]any); ok && len(rows) > 0 {
				return rows
			}
		}
	}
	if rows, ok := root.([]any); ok {
		return rows
	}
	return nil
}

func normalizeWorks(root any) []workVO {
	rows := findList(root)
	if len(rows) > 12 {
		rows = rows[:12]
	}
	result := make([]workVO, 0, len(rows))
	seen := map[string]bool{}
	for _, row := range rows {
		work := normalizeWork(row, "")
		identity := work.ID
		if identity == "" {
			identity = work.PageURL + "|" + work.Title
		}
		if identity == "|" || seen[identity] {
			continue
		}
		seen[identity] = true
		result = append(result, work)
	}
	return result
}

func normalizeProfile(profileRoot, worksRoot any, allowRootIdentity bool) *profileVO {
	profileCandidate := firstValue(profileRoot, "author", "owner", "author_info", "authorInfo", "user_info", "userInfo", "user", "channel")
	worksCandidate := firstValue(worksRoot, "author", "owner", "author_info", "authorInfo", "user_info", "userInfo", "user", "channel")
	root := []any{profileCandidate, profileRoot, worksCandidate, worksRoot}
	profile := &profileVO{
		ID:        truncateText(firstString(root, "sec_uid", "secUid", "sec_user_id", "secUserId", "user_eid", "userEid", "eid", "user_id", "userId", "channel_id", "channelId", "mid", "uid"), 256),
		Name:      truncateText(firstString(root, "nickname", "nick_name", "user_name", "userName", "owner_nickname", "display_name", "displayName", "channel_name", "channelName"), 200),
		Handle:    truncateText(firstString(root, "unique_id", "uniqueId", "kwai_id", "kwaiId", "handle", "short_id", "shortId"), 200),
		AvatarURL: firstURL(root, "avatar_larger", "avatarLarger", "avatar_medium", "avatar", "face", "head_url", "headUrl", "profile_pic_url"),
		Bio:       truncateText(firstString(root, "signature", "bio", "channel_description", "channelDescription", "description"), 2000),
		Followers: truncateText(firstString(root, "follower_count", "followerCount", "follower", "fans_count", "fansCount", "fan_count", "fanCount", "fans", "subscriber_count", "subscriberCount"), 64),
		Following: truncateText(firstString(root, "following_count", "followingCount", "following", "follow_count", "followCount"), 64),
		Likes:     truncateText(firstString(root, "total_favorited", "totalFavorited", "liked_count", "likedCount", "likes"), 64),
		Works:     truncateText(firstString(root, "aweme_count", "awemeCount", "video_count", "videoCount", "photo_count", "photoCount", "notes_count", "notesCount", "archive_count"), 64),
	}
	if profile.ID == "" {
		profile.ID = truncateText(directString(profileCandidate, "id"), 256)
	}
	if profile.ID == "" && allowRootIdentity {
		profile.ID = truncateText(directString(profileRoot, "id"), 256)
	}
	if profile.Name == "" {
		profile.Name = truncateText(directString(profileCandidate, "name"), 200)
	}
	if profile.Name == "" {
		profile.Name = truncateText(scalarString(profileCandidate), 200)
	}
	if profile.Name == "" && allowRootIdentity {
		profile.Name = truncateText(directString(profileRoot, "name", "title", "channel_title", "channelTitle"), 200)
	}
	if profile.Name == "" && profile.Handle == "" && profile.AvatarURL == "" {
		return nil
	}
	return profile
}
