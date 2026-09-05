package videodownload

import "net/url"

// DouyinProviderVideo accepts the documented high-quality response or a single
// aweme detail. It never scans recommendations for a substitute video.
func DouyinProviderVideo(data map[string]any, source, quality string) (*ResolvedVideo, error) {
	u, err := url.Parse(source)
	if err != nil || Platform(source) != "douyin" {
		return nil, failure(400, "无效的抖音作品链接")
	}
	expected := douyinID(u)
	id := str(data, "aweme_id")
	if candidate := str(data, "video_id"); id == "" && numericID.MatchString(candidate) {
		id = candidate
	}
	if id != "" && (!numericID.MatchString(id) || expected != "" && id != expected) {
		return nil, failure(502, "解析服务返回的抖音作品与请求不一致")
	}
	if id == "" {
		id = expected
	}
	if str(data, "original_video_url") == "" {
		if id == "" {
			return nil, nil
		}
		plan, err := douyinItemsPlan([]map[string]any{data}, id, quality)
		if err != nil || plan == nil {
			return nil, err
		}
		return &ResolvedVideo{Metadata: plan.Metadata, URLs: plan.Parts[0].URLs}, nil
	}
	raw := trustedMedia(str(data, "original_video_url"), "douyin")
	if raw == "" {
		return nil, failure(502, "解析服务没有返回可信的抖音视频地址")
	}
	detail := child(data, "video_data")
	if nested := child(detail, "aweme_detail"); nested != nil {
		detail = nested
	}
	if actual := str(detail, "aweme_id"); actual != "" {
		if !numericID.MatchString(actual) || id != "" && actual != id {
			return nil, failure(502, "解析服务返回的抖音作品与请求不一致")
		}
		id = actual
	}
	// Also enforce restrictions carried by the detail, even when a URL exists.
	if _, err := douyinItemsPlan([]map[string]any{data, detail}, id, quality); err != nil {
		return nil, err
	}
	video := child(detail, "video")
	awemeDuration := video != nil || str(detail, "aweme_id") != ""
	if video == nil {
		video = detail
	}
	title := str(detail, "desc")
	if title == "" {
		title = str(detail, "title")
	}
	if title == "" {
		title = "抖音视频"
		if id != "" {
			title += " " + id
		}
	}
	cover := ""
	if urls := array(child(video, "cover"), "url_list"); len(urls) > 0 {
		cover, _ = urls[0].(string)
	}
	page := source
	if id != "" {
		page = "https://www.douyin.com/video/" + id
	}
	duration := number(video, "duration_seconds")
	if duration == 0 && awemeDuration {
		duration = number(video, "duration") / 1000
	}
	// FFprobe-style metadata uses seconds; aweme.video uses milliseconds.
	// Never guess the unit of an undocumented top-level duration field.
	format := child(detail, "format")
	if duration == 0 {
		duration = number(format, "duration")
	}
	size := int64(firstNumber(video, "data_size", "size"))
	if size == 0 {
		size = int64(number(format, "size"))
	}
	width, height := int(number(video, "width")), int(number(video, "height"))
	for _, rawStream := range array(detail, "streams") {
		stream := object(rawStream)
		if str(stream, "codec_type") == "video" && width == 0 && height == 0 {
			width, height = int(number(stream, "width")), int(number(stream, "height"))
		}
	}
	return &ResolvedVideo{Metadata: Metadata{
		Platform: "douyin", SourceURL: page,
		Title: title, CoverURL: cover,
		DurationSeconds: int(duration), Width: width, Height: height,
		EstimatedBytes: size,
	}, URLs: []string{raw}}, nil
}
