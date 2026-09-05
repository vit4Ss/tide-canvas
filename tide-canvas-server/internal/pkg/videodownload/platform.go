// Package videodownload resolves and downloads single public videos locally.
// Native platform resolvers complement yt-dlp; all media is staged before delivery.
package videodownload

import (
	"net/url"
	"regexp"
	"strings"
)

var Platforms = []string{"pinterest", "bilibili", "kuaishou", "douyin", "tiktok", "instagram", "youtube"}
var roots = map[string][]string{
	"pinterest": {"pinterest.com", "pinterest.ca", "pinterest.co.uk", "pinterest.com.au", "pinterest.de", "pinterest.fr", "pinterest.es", "pinterest.it", "pinterest.jp", "pin.it"},
	"bilibili":  {"bilibili.com", "bilibili.tv", "b23.tv"},
	"kuaishou":  {"kuaishou.com", "kwai.com"},
	"douyin":    {"douyin.com", "iesdouyin.com"},
	"tiktok":    {"tiktok.com"}, "instagram": {"instagram.com", "instagr.am"}, "youtube": {"youtube.com", "youtu.be"},
}
var mediaRoots = map[string][]string{
	"pinterest": {"pinimg.com", "pinterestusercontent.com"},
	"bilibili":  {"bilivideo.com", "bilivideo.cn", "hdslb.com", "biliapi.net"},
	"kuaishou":  {"kwaicdn.com", "kwimgs.com", "yximgs.com", "gifshow.com", "kwai.net", "kuaishou.com"},
	"douyin":    {"douyinvod.com", "amemv.com", "snssdk.com", "bytecdn.cn"},
}
var numericID = regexp.MustCompile(`^[0-9]{5,25}$`)
var shortPath = regexp.MustCompile(`^/[A-Za-z0-9_-]+/?$`)
var douyinPath = regexp.MustCompile(`^/(?:share/)?video/([0-9]{5,25})/?$`)
var douyinCategoryPath = regexp.MustCompile(`^/jingxuan/[A-Za-z0-9_-]+/?$`)

func hostIn(host string, domains []string) bool {
	host = strings.ToLower(host)
	for _, root := range domains {
		if host == root || strings.HasSuffix(host, "."+root) {
			return true
		}
	}
	return false
}

func Platform(raw string) string {
	u, err := url.Parse(raw)
	if err != nil {
		return ""
	}
	for _, platform := range Platforms {
		if hostIn(u.Hostname(), roots[platform]) {
			return platform
		}
	}
	return ""
}

func douyinID(u *url.URL) string {
	if !hostIn(u.Hostname(), roots["douyin"]) {
		return ""
	}
	if m := douyinPath.FindStringSubmatch(u.Path); len(m) > 1 {
		return m[1]
	}
	switch strings.TrimSuffix(u.Path, "/") {
	case "", "/jingxuan", "/discover":
	default:
		// Category feeds (e.g. /jingxuan/game) also open single videos using
		// modal_id. Require one valid ID below, then normalize to /video/ID;
		// the category page itself is never used as the download source.
		if !douyinCategoryPath.MatchString(u.Path) {
			return ""
		}
	}
	values, err := url.ParseQuery(u.RawQuery)
	if err != nil {
		return ""
	}
	ids := values["modal_id"]
	if len(ids) == 1 && numericID.MatchString(ids[0]) {
		return ids[0]
	}
	return ""
}

func ValidateSource(raw string) (string, string, error) {
	raw = strings.TrimSpace(raw)
	u, err := url.ParseRequestURI(raw)
	if err != nil || len(raw) > 4096 || u.Scheme != "https" || u.Hostname() == "" || u.User != nil || u.Port() != "" || u.Fragment != "" || strings.Contains(raw, "#") {
		return "", "", failure(400, "请输入不含自定义端口的公开视频 HTTPS 链接")
	}
	p := Platform(raw)
	path := strings.ToLower(u.Path)
	host := strings.ToLower(u.Hostname())
	accepted := false
	switch p {
	case "douyin":
		accepted = douyinID(u) != "" || host == "v.douyin.com" && shortPath.MatchString(path)
	case "bilibili":
		accepted = host == "b23.tv" && shortPath.MatchString(path) || strings.HasPrefix(path, "/video/") || strings.HasPrefix(path, "/bangumi/play/")
	case "pinterest":
		accepted = host == "pin.it" && shortPath.MatchString(path) || strings.HasPrefix(path, "/pin/")
	case "kuaishou":
		accepted = strings.HasPrefix(host, "v.") && shortPath.MatchString(path) || strings.HasPrefix(path, "/short-video/") || strings.HasPrefix(path, "/photo/") || strings.HasPrefix(path, "/fw/photo/") || strings.HasPrefix(path, "/f/") || strings.HasPrefix(path, "/video/") || strings.HasPrefix(path, "/@") && strings.Contains(path, "/video/")
	case "tiktok":
		accepted = (host == "vm.tiktok.com" || host == "vt.tiktok.com") && shortPath.MatchString(path) || strings.HasPrefix(path, "/@") && strings.Contains(path, "/video/") || strings.HasPrefix(path, "/t/")
	case "instagram":
		accepted = strings.HasPrefix(path, "/reel/") || strings.HasPrefix(path, "/reels/") || strings.HasPrefix(path, "/p/") || strings.HasPrefix(path, "/tv/")
	case "youtube":
		accepted = host == "youtu.be" && shortPath.MatchString(path) || path == "/watch" && u.Query().Get("v") != "" || strings.HasPrefix(path, "/shorts/") || strings.HasPrefix(path, "/live/") || strings.HasPrefix(path, "/embed/") || strings.HasPrefix(path, "/clip/")
	}
	if !accepted {
		return "", "", failure(400, "请粘贴支持平台的单个公开视频链接，暂不支持主页、搜索页或播放列表")
	}
	if p == "douyin" && douyinID(u) != "" {
		raw = "https://www.douyin.com/video/" + douyinID(u)
	}
	return raw, p, nil
}

func trustedMedia(raw, platform string) string {
	if strings.HasPrefix(raw, "http://") {
		raw = "https://" + strings.TrimPrefix(raw, "http://")
	}
	u, err := url.ParseRequestURI(raw)
	if err != nil || u.Scheme != "https" || u.User != nil || u.Port() != "" || !hostIn(u.Hostname(), mediaRoots[platform]) {
		return ""
	}
	return u.String()
}

func formatSelector(quality string) string {
	switch quality {
	case "quality":
		return "bv*+ba/b"
	case "speed":
		return "bv*[height<=480]+ba/b[height<=480]/bv*+ba/b"
	default:
		// Prefer a suitable public rendition, but allow an unknown or higher
		// resolution when that is all the platform exposes. finish probes and
		// transcodes it to the requested limit before it can reach the browser.
		return "bv*[vcodec^=avc][height<=1080]+ba[ext=m4a]/b[ext=mp4][height<=1080]/bv*[height<=1080]+ba/b[height<=1080]/bv*+ba/b"
	}
}
