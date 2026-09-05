package videodownload

import (
	"context"
	"encoding/json"
	"html"
	"net/url"
	"regexp"
	"strings"

	xhtml "golang.org/x/net/html"
)

var routerState = regexp.MustCompile(`window\._ROUTER_DATA\s*=\s*`)
var renderState = regexp.MustCompile(`(?is)<script\b[^>]*\bid=["']RENDER_DATA["'][^>]*>(.*?)</script>`)
var embeddedMP4 = regexp.MustCompile(`(?i)https://[^\s"'<>\\]+?\.mp4(?:\?[^\s"'<>\\]*)?`)

func (s *Service) douyin(ctx context.Context, source, quality string) (*downloadPlan, error) {
	u, _ := url.Parse(source)
	id := douyinID(u)
	if id == "" {
		_, final, err := s.fetch(ctx, source, "https://www.douyin.com/")
		if err != nil {
			return nil, err
		}
		id = douyinID(final)
		if id == "" {
			return nil, failure(400, "抖音短链接未指向单个公开视频")
		}
	}
	body, _, err := s.fetch(ctx, "https://www.iesdouyin.com/share/video/"+id+"/", "https://www.douyin.com/")
	if err != nil {
		return nil, err
	}
	return parseDouyin(string(body), id, quality)
}
func parseDouyin(body, id, quality string) (*downloadPlan, error) {
	states := []map[string]any{}
	if loc := routerState.FindStringIndex(body); loc != nil {
		if data, err := decodeJSON(strings.NewReader(body[loc[1]:])); err == nil {
			states = append(states, data)
		}
	}
	if m := renderState.FindStringSubmatch(body); len(m) > 1 {
		if decoded, err := url.PathUnescape(strings.TrimSpace(m[1])); err == nil {
			if data, err := decodeJSON(strings.NewReader(decoded)); err == nil {
				states = append(states, data)
			}
		}
	}
	items := []map[string]any{}
	budget := 20000
	var walk func(any, int)
	walk = func(v any, depth int) {
		if depth > 40 || budget <= 0 {
			return
		}
		budget--
		switch v := v.(type) {
		case map[string]any:
			if str(v, "aweme_id") == id || str(v, "awemeId") == id {
				items = append(items, v)
			}
			for _, c := range v {
				walk(c, depth+1)
			}
		case []any:
			for _, c := range v {
				walk(c, depth+1)
			}
		}
	}
	for _, state := range states {
		walk(state, 0)
	}
	for _, item := range items {
		status := child(item, "status")
		if flag(status, "is_private") || flag(status, "is_delete") {
			return nil, failure(400, "该抖音视频已删除或设为私密")
		}
		if len(array(item, "images")) > 0 {
			return nil, failure(400, "这是图文作品，请提供视频链接")
		}
	}
	for _, item := range items {
		video := child(item, "video")
		type variant struct {
			part          mediaPart
			width, height int
			hevc          bool
		}
		variants := []variant{}
		add := func(addr map[string]any, hevc bool) {
			part := mediaFrom(addr, "douyin")
			if len(part.URLs) == 0 {
				return
			}
			part.Size = int64(number(addr, "data_size"))
			w, h := int(number(addr, "width")), int(number(addr, "height"))
			if w == 0 {
				w = int(number(video, "width"))
			}
			if h == 0 {
				h = int(number(video, "height"))
			}
			variants = append(variants, variant{part, w, h, hevc})
		}
		for _, rate := range array(video, "bit_rate") {
			m := object(rate)
			add(child(m, "play_addr"), flag(m, "is_h265") || flag(m, "is_bytevc1"))
		}
		for _, key := range []string{"play_addr", "playAddr", "play_addr_h264", "play_addr_bytevc1"} {
			add(child(video, key), key == "play_addr_bytevc1" || key != "play_addr_h264" && (flag(video, "is_h265") || flag(video, "is_bytevc1")))
		}
		best := -1
		score := float64(-1)
		for i, v := range variants {
			n := float64(v.height)*1e8 + float64(v.part.Size)
			cap := 1080
			if quality == "speed" {
				cap = 480
			}
			if quality != "quality" && v.height > 0 && v.height <= cap {
				n += 1e14
			}
			if quality == "compat" && !v.hevc {
				n += 1e12
			}
			if n > score {
				score = n
				best = i
			}
		}
		if best < 0 {
			continue
		}
		v := variants[best]
		cover := ""
		for _, c := range array(child(video, "cover"), "url_list") {
			if raw, ok := c.(string); ok {
				cover = raw
				break
			}
		}
		title := str(item, "desc")
		if title == "" {
			title = "抖音视频"
		}
		return &downloadPlan{Metadata: Metadata{Platform: "douyin", SourceURL: "https://www.douyin.com/video/" + id, Title: title, CoverURL: cover, DurationSeconds: int(firstNumber(video, "duration") / 1000), Width: v.width, Height: v.height, EstimatedBytes: v.part.Size}, Parts: []mediaPart{v.part}}, nil
	}
	return nil, nil
}

func (s *Service) sharePage(ctx context.Context, source, platform, quality string) (*downloadPlan, error) {
	body, final, err := s.fetch(ctx, source, source)
	if err != nil {
		return nil, err
	}
	if _, destination, err := ValidateSource(final.String()); err != nil || destination != platform {
		return nil, failure(400, "分享链接未指向单个公开视频，请复制作品链接后重试")
	}
	return parseSharePage(string(body), source, platform, quality), nil
}
func parseSharePage(body, source, platform, quality string) *downloadPlan {
	meta := map[string]string{}
	urls := []string{}
	seen := map[string]bool{}
	add := func(raw string) {
		if u := trustedMedia(raw, platform); u != "" && !seen[u] {
			seen[u] = true
			urls = append(urls, u)
		}
	}
	// Keep each player's alternatives together. Unrelated players are often
	// recommendations and must not compete with the requested video's quality.
	groups := [][]string{}
	addGroup := func(raws []string) {
		group := []string{}
		for _, raw := range raws {
			if u := trustedMedia(raw, platform); u != "" {
				group = append(group, u)
			}
		}
		if len(group) > 0 && len(groups) <= 32 {
			groups = append(groups, group)
		}
	}
	doc, err := xhtml.Parse(strings.NewReader(body))
	if err != nil {
		return nil
	}
	var walk func(*xhtml.Node)
	walk = func(n *xhtml.Node) {
		if n.Type == xhtml.ElementNode {
			attrs := map[string]string{}
			for _, a := range n.Attr {
				attrs[strings.ToLower(a.Key)] = a.Val
			}
			if n.Data == "meta" {
				key := attrs["property"]
				if key == "" {
					key = attrs["name"]
				}
				meta[key] = attrs["content"]
			}
			if n.Data == "video" {
				raws := []string{attrs["src"]}
				for c := n.FirstChild; c != nil; c = c.NextSibling {
					if c.Type == xhtml.ElementNode && c.Data == "source" {
						for _, a := range c.Attr {
							if a.Key == "src" {
								raws = append(raws, a.Val)
							}
						}
					}
				}
				addGroup(raws)
			}
			if n.Data == "script" && attrs["type"] == "application/ld+json" && n.FirstChild != nil {
				var node any
				if json.Unmarshal([]byte(n.FirstChild.Data), &node) == nil {
					items := []any{node}
					if a, ok := node.([]any); ok {
						items = a
					}
					for _, item := range items {
						m := object(item)
						if str(m, "@type") == "VideoObject" {
							addGroup([]string{str(m, "contentUrl")})
							if meta["og:title"] == "" {
								meta["og:title"] = str(m, "name")
							}
						}
					}
				}
			}
		}
		for c := n.FirstChild; c != nil; c = c.NextSibling {
			walk(c)
		}
	}
	walk(doc)
	// Page-level Open Graph identifies the requested work; embedded players
	// may also include recommendations, so prefer explicit primary metadata.
	primary := []string{}
	for _, key := range []string{"og:video:secure_url", "og:video", "og:video:url"} {
		if raw := trustedMedia(meta[key], platform); raw != "" {
			primary = append(primary, raw)
		}
	}
	if len(primary) > 0 {
		urls = primary
	} else {
		if len(groups) > 32 {
			return nil
		}
		for _, group := range groups {
			matches := len(urls) == 0
			for _, raw := range group {
				matches = matches || seen[raw]
			}
			if !matches {
				return nil
			}
			for _, raw := range group {
				add(raw)
			}
		}
	}
	if len(urls) == 0 {
		normalized := strings.NewReplacer(`\u002F`, "/", `\u002f`, "/", `\u0026`, "&", `\/`, "/").Replace(html.UnescapeString(body))
		for _, raw := range embeddedMP4.FindAllString(normalized, 128) {
			add(raw)
		}
		// Without a primary player, several script URLs can belong to different
		// recommended works. Let the platform extractor select the requested ID.
		if len(urls) > 1 {
			return nil
		}
	}
	if len(urls) == 0 {
		return nil
	}
	// Mirror APIRouter's public share-page quality preference; final FFmpeg
	// enforces actual codec/dimensions rather than trusting URL naming alone.
	selected := urls[0]
	for _, raw := range urls {
		lower := strings.ToLower(raw)
		if quality == "speed" && strings.Contains(lower, "_b_") || quality != "speed" && (strings.Contains(lower, "hd15") || strings.Contains(lower, "_hd")) {
			selected = raw
			break
		}
	}
	title := meta["og:title"]
	if title == "" {
		title = "公开视频"
	}
	return &downloadPlan{Metadata: Metadata{Platform: platform, SourceURL: source, Title: title, CoverURL: meta["og:image"]}, Parts: []mediaPart{{URLs: []string{selected}}}}
}
