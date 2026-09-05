package social

import (
	"context"
	"net/url"
	"regexp"
	"strings"
	"time"
)

var (
	douyinNumericID = regexp.MustCompile(`^[0-9]{1,32}$`)
	douyinSecID     = regexp.MustCompile(`^MS4w[0-9A-Za-z_-]{4,252}$`)
)

func douyinWorkID(source *url.URL) string {
	for _, raw := range []string{source.Query().Get("modal_id"), pathSegmentAfter(source, "video"), pathSegmentAfter(source, "note"), source.Query().Get("aweme_id"), source.Query().Get("item_id")} {
		if douyinNumericID.MatchString(raw) {
			return raw
		}
	}
	return ""
}

func douyinData(root any) any {
	for depth := 0; depth < normalizeDepthLimit; depth++ {
		if nested := directValue(root, "data"); nested != nil {
			root = nested
		} else {
			break
		}
	}
	return root
}

func douyinWorkObject(root any, expectedID string) map[string]any {
	root = douyinData(root)
	candidate := directValue(root, "aweme_detail", "aweme_details", "item_list")
	if candidate == nil {
		candidate = root
	}
	rows, ok := candidate.([]any)
	if !ok {
		rows = []any{candidate}
	}
	for _, row := range rows {
		item, ok := row.(map[string]any)
		if !ok {
			continue
		}
		id := directString(item, "aweme_id")
		if id != "" && (expectedID == "" || id == expectedID) {
			return item
		}
	}
	return nil
}

func douyinProfileObject(root any, expectedSecID string) map[string]any {
	root = douyinData(root)
	if nested := directValue(root, "user", "user_info"); nested != nil {
		root = nested
	}
	item, ok := root.(map[string]any)
	if !ok || directString(item, "aweme_id") != "" {
		return nil
	}
	if actual := directString(item, "sec_uid", "sec_user_id"); expectedSecID != "" && actual != "" && actual != expectedSecID {
		return nil
	}
	if directString(item, "nickname", "unique_id", "short_id") == "" && douyinAvatar(item) == "" {
		return nil
	}
	return item
}

func douyinAvatar(item any) string {
	for _, key := range []string{"avatar_larger", "avatar_medium", "avatar_thumb", "avatar"} {
		if avatar := urlFromValue(directValue(item, key), 0); avatar != "" {
			return avatar
		}
	}
	return ""
}

func douyinProfile(root any, identifier string) *profileVO {
	item := douyinProfileObject(root, identifier)
	if item == nil {
		return nil
	}
	profile := &profileVO{
		ID:        truncateText(directString(item, "sec_uid", "sec_user_id", "uid", "user_id"), 256),
		Name:      truncateText(directString(item, "nickname"), 200),
		Handle:    truncateText(directString(item, "unique_id", "short_id"), 200),
		AvatarURL: douyinAvatar(item), Bio: truncateText(directString(item, "signature"), 2000),
		Followers: truncateText(directString(item, "follower_count"), 64), Following: truncateText(directString(item, "following_count"), 64),
		Likes: truncateText(directString(item, "total_favorited"), 64), Works: truncateText(directString(item, "aweme_count"), 64),
	}
	if identifier == "" {
		identifier = directString(item, "sec_uid", "sec_user_id")
	}
	if douyinSecID.MatchString(identifier) {
		profile.ID = identifier
		profile.PageURL = "https://www.douyin.com/user/" + url.PathEscape(identifier)
	}
	if enriched := platformProfile(platformDouyin, item, nil, true); enriched != nil {
		profile.Details = enriched.Details
	}
	return profile
}

// App may respond successfully with aweme_detail=null and filter_list. The
// official docs recommend trying the Web endpoint once for this case.
func (h *handler) fetchDouyinWork(ctx context.Context, cfg settings, source *url.URL) (map[string]any, error) {
	id := douyinWorkID(source)
	calls := []upstreamCall{
		{"/api/v1/douyin/app/v3/fetch_one_video_by_share_url", url.Values{"share_url": {source.String()}}},
		{"/api/v1/douyin/web/fetch_one_video_by_share_url", url.Values{"share_url": {source.String()}}},
	}
	if id != "" {
		calls = []upstreamCall{
			{"/api/v1/douyin/app/v3/fetch_one_video", url.Values{"aweme_id": {id}}},
			{"/api/v1/douyin/web/fetch_one_video", url.Values{"aweme_id": {id}}},
		}
	}
	var lastErr error
	var filterReason string
	for _, call := range calls {
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
		data, err := h.tikhubGet(ctx, cfg, call.path, call.query)
		if err != nil {
			lastErr = err
			continue
		}
		if item := douyinWorkObject(data, id); item != nil {
			return item, nil
		}
		if rows, ok := directValue(douyinData(data), "filter_list").([]any); ok && len(rows) > 0 {
			filterReason = directString(rows[0], "reason")
		}
	}
	switch filterReason {
	case "5", "10":
		return nil, &upstreamError{message: "该抖音作品不是公开可访问内容，请提供公开作品或作者主页链接"}
	case "8":
		return nil, &upstreamError{message: "该抖音作品可能已删除或存在地区/版权访问限制，请尝试作者主页链接"}
	}
	if lastErr != nil {
		return nil, lastErr
	}
	return nil, &upstreamError{message: "抖音作品接口暂未返回有效详情，已尝试 App 和 Web 接口；请确认链接公开且有效"}
}

func (h *handler) inspectDouyinContent(ctx context.Context, cfg settings, source *url.URL) (*inspectVO, error) {
	ctx, cancel := context.WithTimeout(ctx, 55*time.Second)
	defer cancel()
	item, err := h.fetchDouyinWork(ctx, cfg, source)
	if err != nil {
		return nil, err
	}
	work := normalizePlatformWork(platformDouyin, item, "https://www.douyin.com/video/"+url.PathEscape(directString(item, "aweme_id")))
	return &inspectVO{Content: &work, Profile: douyinProfile(directValue(item, "author"), ""), Works: []workVO{}, Warnings: []string{}}, nil
}

func (h *handler) douyinAccountIdentity(ctx context.Context, cfg settings, source *url.URL) (string, map[string]any, bool, error) {
	if id := pathSegmentAfter(source, "user"); douyinSecID.MatchString(id) {
		return id, nil, false, nil
	}
	videoID := douyinWorkID(source)
	if videoID == "" {
		for _, key := range []string{"sec_uid", "sec_user_id"} {
			if id := source.Query().Get(key); douyinSecID.MatchString(id) {
				return id, nil, false, nil
			}
		}
		// A feed/search URL does not identify a creator. Do not spend requests
		// trying to pass it through the homepage-ID endpoint.
		host := strings.ToLower(source.Hostname())
		if host == "www.douyin.com" || host == "douyin.com" {
			if pathSegmentAfter(source, "user") == "" {
				return "", nil, false, &upstreamError{message: "这个链接没有具体作品或账号信息，请复制作品分享链接或作者主页链接"}
			}
		}
		data, err := h.tikhubGet(ctx, cfg, "/api/v1/douyin/web/get_sec_user_id", url.Values{"url": {source.String()}})
		if err == nil {
			root := douyinData(data)
			id := directString(root, "sec_user_id", "sec_uid")
			if id == "" {
				id = scalarString(root)
			}
			// Numeric UID, short_id, and sec_user_id are not interchangeable.
			if douyinSecID.MatchString(id) {
				return id, nil, false, nil
			}
		}
		if ctx.Err() != nil {
			return "", nil, false, ctx.Err()
		}
	}
	// Works (including jingxuan?modal_id, /video, /note and short shares)
	// identify their own author. Never search unrelated recommendations for IDs.
	work, err := h.fetchDouyinWork(ctx, cfg, source)
	if err != nil {
		return "", nil, false, err
	}
	owner, _ := directValue(work, "author").(map[string]any)
	id := directString(owner, "sec_uid", "sec_user_id")
	if !douyinSecID.MatchString(id) {
		uid := directString(owner, "uid", "user_id")
		if douyinNumericID.MatchString(uid) && ctx.Err() == nil {
			data, lookupErr := h.tikhubGet(ctx, cfg, "/api/v1/douyin/web/fetch_user_profile_by_uid", url.Values{"uid": {uid}})
			if lookupErr == nil {
				if profile := douyinProfileObject(data, ""); profile != nil {
					if actualUID := directString(profile, "uid", "user_id"); actualUID == uid {
						owner = profile
						id = directString(profile, "sec_uid", "sec_user_id")
					}
				}
			}
		}
	}
	if !douyinSecID.MatchString(id) {
		return "", nil, false, &upstreamError{message: "已读取抖音作品，但未取得作者的有效账号标识，请尝试作者主页链接"}
	}
	return id, owner, true, nil
}

func douyinAccountWorks(data any, identifier string) []workVO {
	rows, _ := directValue(douyinData(data), "aweme_list").([]any)
	selected := make([]any, 0, 12)
	for _, row := range rows {
		if actual := directString(directValue(row, "author"), "sec_uid", "sec_user_id"); actual != "" && actual != identifier {
			continue
		}
		if directString(row, "aweme_id") == "" {
			continue
		}
		selected = append(selected, row)
		if len(selected) == 12 {
			break
		}
	}
	return normalizePlatformWorks(platformDouyin, selected)
}

func douyinZeroPostAccount(profile *profileVO, data any, err error) bool {
	rows, ok := directValue(douyinData(data), "aweme_list").([]any)
	return profile != nil && profile.Works == "0" && err == nil && ok && len(rows) == 0
}

func (h *handler) inspectDouyinAccount(ctx context.Context, cfg settings, source *url.URL) (*inspectVO, error) {
	ctx, cancel := context.WithTimeout(ctx, 55*time.Second)
	defer cancel()
	identifier, owner, fromWork, err := h.douyinAccountIdentity(ctx, cfg, source)
	if err != nil {
		return nil, err
	}
	warnings := []string{}
	if fromWork {
		warnings = append(warnings, "已根据作品链接识别作者，本次展示该作者的账号数据")
	}
	data, errs := h.tikhubMany(ctx, cfg, []upstreamCall{
		{"/api/v1/douyin/app/v3/handler_user_profile", url.Values{"sec_user_id": {identifier}}},
		{"/api/v1/douyin/app/v3/fetch_user_post_videos", url.Values{"sec_user_id": {identifier}, "max_cursor": {"0"}, "count": {"12"}, "sort_type": {"0"}}},
	})
	profile := douyinProfile(data[0], identifier)
	works := douyinAccountWorks(data[1], identifier)
	// Fallback only the missing half. An explicit zero-post account is valid.
	fallbacks := []upstreamCall{}
	if profile == nil {
		fallbacks = append(fallbacks, upstreamCall{"/api/v1/douyin/web/handler_user_profile", url.Values{"sec_user_id": {identifier}}})
	}
	if len(works) == 0 && !douyinZeroPostAccount(profile, data[1], errs[1]) {
		fallbacks = append(fallbacks, upstreamCall{"/api/v1/douyin/web/fetch_user_post_videos", url.Values{"sec_user_id": {identifier}, "max_cursor": {"0"}, "count": {"12"}}})
	}
	if len(fallbacks) > 0 && ctx.Err() == nil {
		extra, extraErrs := h.tikhubMany(ctx, cfg, fallbacks)
		for i, call := range fallbacks {
			if strings.HasSuffix(call.path, "handler_user_profile") {
				profile = douyinProfile(extra[i], identifier)
				errs[0] = extraErrs[i]
			} else {
				works = douyinAccountWorks(extra[i], identifier)
				data[1] = extra[i]
				errs[1] = extraErrs[i]
			}
		}
	}
	if profile == nil {
		warnings = append(warnings, "抖音账号资料暂未完整返回，已尝试从作品作者信息补充")
		profile = douyinProfile(owner, identifier)
		if profile == nil {
			if rows, _ := directValue(douyinData(data[1]), "aweme_list").([]any); len(rows) > 0 {
				for _, row := range rows {
					if candidate := douyinProfile(directValue(row, "author"), identifier); candidate != nil {
						profile = candidate
						break
					}
				}
			}
		}
	}
	if profile == nil && len(works) == 0 {
		if errs[0] != nil {
			return nil, errs[0]
		}
		if errs[1] != nil {
			return nil, errs[1]
		}
		return nil, &upstreamError{message: "已识别抖音账号，但 App 和 Web 接口均未返回可用资料或公开作品，请稍后重试"}
	}
	if len(works) == 0 {
		if douyinZeroPostAccount(profile, data[1], errs[1]) {
			warnings = append(warnings, "该账号当前没有公开作品")
		} else {
			warnings = append(warnings, "抖音近期公开作品暂未返回，本次仅展示已获取的账号资料")
		}
	}
	return &inspectVO{Profile: profile, Works: works, Warnings: warnings}, nil
}
