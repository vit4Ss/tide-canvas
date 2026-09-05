package videodownload

import (
	"context"
	"fmt"
	"net/url"
	"regexp"
	"strconv"
	"strings"
)

var biliID = regexp.MustCompile(`(?i)^/video/(BV[0-9a-z]{10,20}|av[0-9]+)/?$`)

func (s *Service) bilibili(ctx context.Context, source, quality string) (*downloadPlan, error) {
	u, _ := url.Parse(source)
	if u.Hostname() == "b23.tv" {
		_, final, err := s.fetch(ctx, source, "https://www.bilibili.com/")
		if err != nil {
			return nil, err
		}
		var p string
		source, p, err = ValidateSource(final.String())
		if err != nil || p != "bilibili" {
			return nil, failure(400, "B 站短链接未指向单个公开视频")
		}
		u = final
	}
	m := biliID.FindStringSubmatch(u.Path)
	if len(m) < 2 {
		return nil, nil
	} // Bangumi/other public variants use yt-dlp.
	key := "bvid"
	id := m[1]
	if strings.HasPrefix(strings.ToLower(id), "av") {
		key = "aid"
		id = id[2:]
	}
	root, err := s.fetchJSON(ctx, "https://api.bilibili.com/x/web-interface/view?"+key+"="+url.QueryEscape(id), source)
	if err != nil {
		return nil, err
	}
	data, err := biliPayload(root)
	if err != nil {
		return nil, err
	}
	if flag(child(data, "rights"), "pay") || flag(data, "is_upower_exclusive") {
		return nil, failure(400, "该 B 站视频需要付费或专属权限，无法公开下载")
	}
	if number(data, "state") != 0 || str(data, "state") != "" && str(data, "state") != "0" {
		return nil, failure(400, "该 B 站视频当前不可公开访问")
	}
	pageNum := 1
	if raw := u.Query().Get("p"); raw != "" {
		pageNum, err = strconv.Atoi(raw)
		if err != nil || pageNum < 1 {
			return nil, failure(400, "B 站分 P 参数无效")
		}
	}
	page := data
	pages := array(data, "pages")
	if len(pages) > 0 {
		if pageNum > len(pages) {
			return nil, failure(400, "该视频分 P 不存在")
		}
		page = object(pages[pageNum-1])
	}
	cid := str(page, "cid")
	if cid == "" {
		return nil, failure(502, "B 站未返回视频分 P 信息")
	}
	title := str(data, "title")
	if len(pages) > 1 && str(page, "part") != "" {
		title += " - " + str(page, "part")
	}
	duration := number(page, "duration")
	if duration == 0 {
		duration = number(data, "duration")
	}
	dim := child(page, "dimension")
	if number(dim, "height") == 0 {
		dim = child(data, "dimension")
	}
	cover := str(data, "pic")
	if strings.HasPrefix(cover, "http://") {
		cover = "https://" + strings.TrimPrefix(cover, "http://")
	}
	base := Metadata{Platform: "bilibili", SourceURL: source, Title: title, CoverURL: cover, DurationSeconds: int(duration), Width: int(number(dim, "width")), Height: int(number(dim, "height"))}
	qn := 112
	if quality == "compat" {
		qn = 80
	}
	if quality == "speed" {
		qn = 32
	}
	formats := []int{0, 4048}
	if quality == "quality" {
		// Ask for all DASH renditions before accepting the progressive fallback,
		// which can be lower resolution even when a higher public stream exists.
		formats = []int{4048, 0}
	}
	for _, fnval := range formats {
		endpoint := fmt.Sprintf("https://api.bilibili.com/x/player/playurl?%s=%s&cid=%s&qn=%d&fnver=0&fnval=%d&fourk=1", key, url.QueryEscape(id), url.QueryEscape(cid), qn, fnval)
		root, err = s.fetchJSON(ctx, endpoint, source)
		if err != nil {
			continue
		}
		play, err := biliPayload(root)
		if err != nil {
			return nil, err
		}
		if flag(play, "is_preview") || flag(play, "is_pay") || flag(child(play, "durl"), "is_preview") {
			return nil, failure(400, "该视频需要付费或仅提供试看，无法下载完整视频")
		}
		plan := &downloadPlan{Metadata: base}
		parts := array(play, "durl")
		if len(parts) > 0 {
			if len(parts) > 32 {
				return nil, failure(400, "视频分段过多，暂不支持下载")
			}
			for _, v := range parts {
				p := mediaFrom(object(v), "bilibili")
				if len(p.URLs) == 0 {
					plan.Parts = nil
					break
				}
				plan.Parts = append(plan.Parts, p)
				plan.EstimatedBytes += p.Size
			}
			if len(plan.Parts) > 0 {
				// Progressive API dimensions describe the original; qn tells the
				// actual public rendition, which may be lower without login.
				heights := map[int]int{16: 360, 32: 480, 64: 720, 74: 720, 80: 1080, 112: 1080, 116: 1080, 120: 2160}
				if h := heights[int(number(play, "quality"))]; h > 0 && base.Height > h {
					plan.Height = h
					plan.Width = base.Width * h / base.Height
				}
				return plan, nil
			}
		}
		dash := child(play, "dash")
		video := selectBiliStream(array(dash, "video"), quality, false)
		audio := selectBiliStream(array(dash, "audio"), quality, true)
		if video != nil && audio != nil {
			v, a := mediaFrom(video, "bilibili"), mediaFrom(audio, "bilibili")
			if len(v.URLs) == 0 || len(a.URLs) == 0 {
				continue
			}
			plan.Parts = []mediaPart{v}
			plan.Audio = &a
			plan.Width = int(number(video, "width"))
			plan.Height = int(number(video, "height"))
			plan.EstimatedBytes = int64((number(video, "bandwidth") + number(audio, "bandwidth")) * duration / 8)
			return plan, nil
		}
	}
	return nil, nil
}
func biliPayload(root map[string]any) (map[string]any, error) {
	// Keep signed numeric codes (number() intentionally clamps metrics).
	code := fmt.Sprint(root["code"])
	if code != "0" && code != "<nil>" {
		switch code {
		case "-404", "-403", "-10403", "-10500", "-101", "-400":
			return nil, failure(400, "该 B 站视频不可公开访问或需要登录/付费")
		}
		return nil, failure(502, "B 站公开接口暂时不可用")
	}
	if data := child(root, "data"); data != nil {
		return data, nil
	}
	if data := child(root, "result"); data != nil {
		return data, nil
	}
	return nil, failure(502, "B 站返回了不完整的播放信息")
}
func mediaFrom(m map[string]any, platform string) mediaPart {
	p := mediaPart{Size: int64(number(m, "size"))}
	seen := map[string]bool{}
	add := func(raw string) {
		if u := trustedMedia(raw, platform); u != "" && !seen[u] {
			seen[u] = true
			p.URLs = append(p.URLs, u)
		}
	}
	for _, k := range []string{"url", "baseUrl", "base_url"} {
		add(str(m, k))
	}
	for _, k := range []string{"backup_url", "backupUrl", "url_list", "urlList"} {
		for _, v := range array(m, k) {
			if s, ok := v.(string); ok {
				add(s)
			}
		}
	}
	return p
}
func selectBiliStream(values []any, quality string, audio bool) map[string]any {
	var best map[string]any
	bestScore := float64(-1)
	for _, v := range values {
		m := object(v)
		if len(mediaFrom(m, "bilibili").URLs) == 0 {
			continue
		}
		h := number(m, "height")
		if !audio && quality == "compat" && h > 1080 || !audio && quality == "speed" && h > 480 {
			continue
		}
		score := h*1e8 + number(m, "bandwidth")
		if audio {
			score = number(m, "bandwidth")
			if strings.HasPrefix(str(m, "codecs"), "mp4a") {
				score += 1e12
			}
		} else if quality == "compat" && strings.HasPrefix(str(m, "codecs"), "avc") {
			score += 1e13
		}
		if score > bestScore {
			bestScore = score
			best = m
		}
	}
	return best
}
