// Package social exposes the authenticated multi-platform analysis bridge.
// Browser callers provide only a supported public URL and a content/account
// mode; TikHub credentials and allow-listed upstream paths stay server-side.
package social

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"go.uber.org/zap"
	"gorm.io/gorm"

	"tidecanvas/internal/app"
	"tidecanvas/internal/middleware"
	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/idgen"
	"tidecanvas/internal/pkg/logger"
	"tidecanvas/internal/pkg/response"
)

const (
	maxSourceURLLength = 4096
	maxUpstreamBody    = 10 << 20
	maxInspectBody     = 16 << 10
)

var (
	errUnsupported   = errors.New("unsupported social platform")
	errInvalidURL    = errors.New("invalid social url")
	youtubeIDPattern = regexp.MustCompile(`^[A-Za-z0-9_-]{6,32}$`)
	sourceURLPattern = regexp.MustCompile(`https?://[^\s<>"']+`)
)

type platform string

const (
	platformDouyin      platform = "douyin"
	platformBilibili    platform = "bilibili"
	platformXiaohongshu platform = "xiaohongshu"
	platformYouTube     platform = "youtube"
	platformTikTok      platform = "tiktok"
	platformKuaishou    platform = "kuaishou"
)

var platformLabels = map[platform]string{
	platformDouyin:      "抖音",
	platformBilibili:    "哔哩哔哩",
	platformXiaohongshu: "小红书",
	platformYouTube:     "YouTube",
	platformTikTok:      "TikTok",
	platformKuaishou:    "快手",
}

type inspectDTO struct {
	URL  string `json:"url" binding:"required"`
	Kind string `json:"kind" binding:"required,oneof=content account"`
}

type statusVO struct {
	Enabled                bool         `json:"enabled"`
	Configured             bool         `json:"configured"`
	VideoAnalysisSkillID   string       `json:"videoAnalysisSkillId"`
	AccountAnalysisSkillID string       `json:"accountAnalysisSkillId"`
	Platforms              []platformVO `json:"platforms"`
}

type platformVO struct {
	Key   platform `json:"key"`
	Label string   `json:"label"`
}

type metricVO struct {
	Play     string `json:"play,omitempty"`
	Like     string `json:"like,omitempty"`
	Comment  string `json:"comment,omitempty"`
	Share    string `json:"share,omitempty"`
	Favorite string `json:"favorite,omitempty"`
}

type profileVO struct {
	ID        string `json:"id,omitempty"`
	Name      string `json:"name,omitempty"`
	Handle    string `json:"handle,omitempty"`
	AvatarURL string `json:"avatarUrl,omitempty"`
	Bio       string `json:"bio,omitempty"`
	Followers string `json:"followers,omitempty"`
	Following string `json:"following,omitempty"`
	Likes     string `json:"likes,omitempty"`
	Works     string `json:"works,omitempty"`
}

type workVO struct {
	ID          string   `json:"id,omitempty"`
	Title       string   `json:"title,omitempty"`
	Description string   `json:"description,omitempty"`
	CoverURL    string   `json:"coverUrl,omitempty"`
	MediaURL    string   `json:"mediaUrl,omitempty"`
	MediaURLs   []string `json:"mediaUrls"`
	PageURL     string   `json:"pageUrl,omitempty"`
	MediaType   string   `json:"mediaType,omitempty"`
	Duration    string   `json:"duration,omitempty"`
	PublishedAt string   `json:"publishedAt,omitempty"`
	Stats       metricVO `json:"stats"`
}

type inspectVO struct {
	Platform     platform   `json:"platform"`
	PlatformName string     `json:"platformName"`
	Kind         string     `json:"kind"`
	SourceURL    string     `json:"sourceUrl"`
	Profile      *profileVO `json:"profile,omitempty"`
	Content      *workVO    `json:"content,omitempty"`
	Works        []workVO   `json:"works"`
	Warnings     []string   `json:"warnings"`
	FetchedAt    int64      `json:"fetchedAt"`
}

type settings struct {
	enabled bool
	baseURL string
	apiKey  string
}

type handler struct {
	db         *gorm.DB
	httpcli    *http.Client
	downloader *relayVideoDownloader
}

type upstreamError struct{ message string }

func (e *upstreamError) Error() string { return e.message }

// Register mounts the social-analysis workbench API.
func Register(api *gin.RouterGroup, d *app.Deps) {
	downloader := (*relayVideoDownloader)(nil)
	if d != nil && d.Cfg != nil {
		downloader = newRelayVideoDownloader(d.Cfg.Relay.BaseURL, d.Cfg.Relay.APIKey)
	}
	h := &handler{
		db:         d.DB,
		httpcli:    newTikHubHTTPClient(),
		downloader: downloader,
	}
	api.GET("/social-analysis/downloader/download/:token", videoDownloadTicketAuth(), h.downloadVideo)
	g := api.Group("/social-analysis")
	g.Use(middleware.JWTAuth(d))
	g.GET("/status", h.status)
	g.GET("/downloader/platforms", h.downloaderPlatforms)
	g.POST("/downloader/resolve", middleware.RateLimit(d, 15, time.Minute), h.resolveVideoDownload)
	g.POST("/inspect", middleware.RateLimit(d, 20, time.Minute), h.inspect)
}

func newTikHubHTTPClient() *http.Client {
	return &http.Client{
		Timeout: 35 * time.Second,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) >= 3 {
				return errors.New("too many TikHub redirects")
			}
			if len(via) > 0 && (!strings.EqualFold(req.URL.Scheme, via[0].URL.Scheme) || !strings.EqualFold(req.URL.Host, via[0].URL.Host)) {
				return errors.New("cross-host TikHub redirect is not allowed")
			}
			return nil
		},
	}
}

func supportedPlatforms() []platformVO {
	keys := []platform{
		platformDouyin, platformBilibili, platformXiaohongshu,
		platformYouTube, platformTikTok, platformKuaishou,
	}
	rows := make([]platformVO, 0, len(keys))
	for _, key := range keys {
		rows = append(rows, platformVO{Key: key, Label: platformLabels[key]})
	}
	return rows
}

func (h *handler) loadSettings() (settings, error) {
	var rows []model.SysConfig
	if err := h.db.Where("config_key IN ?", model.SocialAnalysisConfigKeys).Find(&rows).Error; err != nil {
		return settings{}, err
	}
	values := make(map[string]string, len(rows))
	for i := range rows {
		values[rows[i].ConfigKey] = strings.TrimSpace(rows[i].ConfigValue)
	}
	baseURL := values[model.ConfigKeySocialTikHubBaseURL]
	if baseURL == "" {
		baseURL = model.DefaultSocialTikHubBaseURL
	}
	apiKey := strings.TrimSpace(values[model.ConfigKeySocialTikHubAPIKey])
	if strings.HasPrefix(strings.ToLower(apiKey), "bearer ") {
		apiKey = strings.TrimSpace(apiKey[len("Bearer "):])
	}
	return settings{
		enabled: values[model.ConfigKeySocialTikHubEnabled] != "0",
		baseURL: strings.TrimRight(baseURL, "/"),
		apiKey:  apiKey,
	}, nil
}

func (h *handler) status(c *gin.Context) {
	cfg, err := h.loadSettings()
	if err != nil {
		response.Fail(c, response.CodeServerError, "failed to load social analysis settings")
		return
	}
	var videoAnalysisSkillID idgen.ID
	var accountAnalysisSkillID idgen.ID
	h.db.Model(&model.Skill{}).
		Where("seed_key = ? AND status = 1", "tool-video-analysis").
		Limit(1).Pluck("id", &videoAnalysisSkillID)
	h.db.Model(&model.Skill{}).
		Where("seed_key = ? AND status = 1", "tool-account-analysis").
		Limit(1).Pluck("id", &accountAnalysisSkillID)
	response.OK(c, statusVO{
		Enabled: cfg.enabled, Configured: cfg.apiKey != "",
		VideoAnalysisSkillID: skillIDString(videoAnalysisSkillID), AccountAnalysisSkillID: skillIDString(accountAnalysisSkillID),
		Platforms: supportedPlatforms(),
	})
}

func skillIDString(id idgen.ID) string {
	if id == 0 {
		return ""
	}
	return id.String()
}

func (h *handler) inspect(c *gin.Context) {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxInspectBody)
	var dto inspectDTO
	if err := c.ShouldBindJSON(&dto); err != nil {
		response.Fail(c, response.CodeBadRequest, "请输入作品或账号链接")
		return
	}
	rawURL := strings.TrimSpace(dto.URL)
	if len(rawURL) == 0 || len(rawURL) > maxSourceURLLength {
		response.Fail(c, response.CodeBadRequest, "链接格式不正确")
		return
	}
	parsed, p, err := parseSourceURL(rawURL)
	if err != nil {
		msg := "链接格式不正确"
		if errors.Is(err, errUnsupported) {
			msg = "暂不支持该平台，请使用抖音、哔哩哔哩、小红书、YouTube、TikTok 或快手链接"
		}
		response.Fail(c, response.CodeBadRequest, msg)
		return
	}
	cfg, err := h.loadSettings()
	if err != nil {
		response.Fail(c, response.CodeServerError, "failed to load social analysis settings")
		return
	}
	if !cfg.enabled {
		response.Fail(c, response.CodeToolDisabled, "内容拆解功能暂未开放")
		return
	}
	if cfg.apiKey == "" {
		response.Fail(c, response.CodeToolDisabled, "内容拆解服务尚未配置，请联系管理员配置 TikHub API Key")
		return
	}

	var result *inspectVO
	if dto.Kind == "account" {
		result, err = h.inspectAccount(c.Request.Context(), cfg, p, parsed)
	} else {
		result, err = h.inspectContent(c.Request.Context(), cfg, p, parsed)
	}
	if err != nil {
		logger.L().Warn("social analysis inspect failed",
			zap.String("platform", string(p)), zap.String("kind", dto.Kind), zap.Error(err))
		var upstream *upstreamError
		if errors.As(err, &upstream) {
			response.Fail(c, response.CodeBadRequest, "平台解析失败："+safeMessage(upstream.message))
			return
		}
		response.Fail(c, response.CodeServerError, "social analysis upstream request failed")
		return
	}
	result.Kind = dto.Kind
	result.SourceURL = parsed.String()
	result.Platform = p
	result.PlatformName = platformLabels[p]
	result.FetchedAt = time.Now().UnixMilli()
	if result.Works == nil {
		result.Works = []workVO{}
	}
	if result.Warnings == nil {
		result.Warnings = []string{}
	}
	response.OK(c, result)
}

func parseSourceURL(raw string) (*url.URL, platform, error) {
	candidate := strings.TrimSpace(raw)
	if match := sourceURLPattern.FindString(candidate); match != "" {
		candidate = strings.TrimRight(match, ".,;!?，。；！？、）)]}》】")
	}
	u, err := url.Parse(candidate)
	if err != nil || (u.Scheme != "https" && u.Scheme != "http") || u.Hostname() == "" || u.User != nil {
		return nil, "", errInvalidURL
	}
	u.Fragment = ""
	host := strings.ToLower(strings.TrimSuffix(u.Hostname(), "."))
	match := func(domain string) bool { return host == domain || strings.HasSuffix(host, "."+domain) }
	switch {
	case match("douyin.com"), match("iesdouyin.com"):
		return u, platformDouyin, nil
	case match("bilibili.com"), match("b23.tv"):
		return u, platformBilibili, nil
	case match("xiaohongshu.com"), match("xhslink.com"), match("xhslink.cn"):
		return u, platformXiaohongshu, nil
	case match("youtube.com"), match("youtu.be"):
		return u, platformYouTube, nil
	case match("tiktok.com"):
		return u, platformTikTok, nil
	case match("kuaishou.com"):
		return u, platformKuaishou, nil
	default:
		return nil, "", errUnsupported
	}
}

func (h *handler) inspectContent(ctx context.Context, cfg settings, p platform, source *url.URL) (*inspectVO, error) {
	var data any
	var err error
	warnings := []string{}
	sourceURL := source.String()
	switch p {
	case platformDouyin:
		data, err = h.tikhubGet(ctx, cfg, "/api/v1/douyin/app/v3/fetch_one_video_by_share_url", url.Values{"share_url": {sourceURL}})
	case platformBilibili:
		data, err = h.tikhubGet(ctx, cfg, "/api/v1/bilibili/web/fetch_one_video_v3", url.Values{"url": {sourceURL}})
	case platformXiaohongshu:
		data, err = h.tikhubGet(ctx, cfg, "/api/v1/xiaohongshu/app_v2/get_mixed_note_detail", url.Values{"share_text": {sourceURL}})
		if err == nil && isVideoTree(data) && findMediaURL(data) == "" {
			if videoData, videoErr := h.tikhubGet(ctx, cfg, "/api/v1/xiaohongshu/app_v2/get_video_note_detail", url.Values{"share_text": {sourceURL}}); videoErr == nil {
				data = []any{data, videoData}
			} else {
				warnings = append(warnings, "已读取笔记信息，但视频播放地址暂未返回")
			}
		}
	case platformYouTube:
		videoID := youtubeVideoID(source)
		if videoID == "" {
			return nil, &upstreamError{message: "无法从 YouTube 链接识别视频 ID"}
		}
		infoQuery := url.Values{"video_id": {videoID}, "need_format": {"true"}}
		streamQuery := url.Values{"video_id": {videoID}, "video_url": {sourceURL}}
		primary, secondary, pairErr := h.tikhubPair(ctx, cfg,
			upstreamCall{"/api/v1/youtube/web_v2/get_video_info_v2", infoQuery},
			upstreamCall{"/api/v1/youtube/web_v2/get_video_streams_v2", streamQuery},
		)
		if pairErr != nil {
			return nil, pairErr
		}
		if primary == nil {
			warnings = append(warnings, "YouTube 基础信息接口暂未返回，已使用视频流信息补充")
		}
		if secondary == nil {
			warnings = append(warnings, "已读取 YouTube 视频信息，但视频流地址暂未返回")
		}
		if mergedURL := findYouTubeMergedMediaURL(secondary); mergedURL != "" {
			data = []any{map[string]any{"preferred_media_url": mergedURL}, primary, secondary}
		} else {
			data = []any{primary, secondary}
			if secondary != nil {
				warnings = append(warnings, "YouTube 未返回可直接归档的音视频合并格式")
			}
		}
	case platformTikTok:
		data, err = h.tikhubGet(ctx, cfg, "/api/v1/tiktok/app/v3/fetch_one_video_by_share_url_v2", url.Values{"share_url": {sourceURL}})
	case platformKuaishou:
		data, err = h.tikhubGet(ctx, cfg, "/api/v1/kuaishou/app/fetch_one_video_by_url", url.Values{"share_text": {sourceURL}})
	}
	if err != nil {
		return nil, err
	}
	content := normalizeWork(data, sourceURL)
	if !workHasData(content) {
		return nil, &upstreamError{message: "平台已响应，但返回结构中没有可识别的作品信息"}
	}
	return &inspectVO{Profile: normalizeProfile(data, nil, false), Content: &content, Works: []workVO{}, Warnings: warnings}, nil
}

type upstreamCall struct {
	path  string
	query url.Values
}

func (h *handler) tikhubPair(ctx context.Context, cfg settings, first, second upstreamCall) (any, any, error) {
	data, errs := h.tikhubMany(ctx, cfg, []upstreamCall{first, second})
	if errs[0] != nil && errs[1] != nil {
		return nil, nil, errs[0]
	}
	return data[0], data[1], nil
}

func (h *handler) tikhubMany(ctx context.Context, cfg settings, calls []upstreamCall) ([]any, []error) {
	type outcome struct {
		index int
		data  any
		err   error
	}
	results := make(chan outcome, len(calls))
	var wg sync.WaitGroup
	for index, call := range calls {
		wg.Add(1)
		go func(index int, call upstreamCall) {
			defer wg.Done()
			data, err := h.tikhubGet(ctx, cfg, call.path, call.query)
			results <- outcome{index: index, data: data, err: err}
		}(index, call)
	}
	wg.Wait()
	close(results)
	data := make([]any, len(calls))
	errs := make([]error, len(calls))
	for result := range results {
		data[result.index], errs[result.index] = result.data, result.err
	}
	return data, errs
}

func (h *handler) inspectAccount(ctx context.Context, cfg settings, p platform, source *url.URL) (*inspectVO, error) {
	sourceURL := source.String()
	var profileData, worksData any
	var err error
	extraWarnings := []string{}
	switch p {
	case platformDouyin:
		identifier := pathSegmentAfter(source, "user")
		if identifier == "" {
			identifier, err = h.resolveIdentifier(ctx, cfg, "/api/v1/douyin/web/get_sec_user_id", url.Values{"url": {sourceURL}}, "sec_user_id", "sec_uid", "user_id")
			if err != nil {
				return nil, err
			}
		}
		profileData, worksData, err = h.tikhubPair(ctx, cfg,
			upstreamCall{"/api/v1/douyin/app/v3/handler_user_profile", url.Values{"sec_user_id": {identifier}}},
			upstreamCall{"/api/v1/douyin/app/v3/fetch_user_post_videos", url.Values{"sec_user_id": {identifier}, "max_cursor": {"0"}, "count": {"12"}, "sort_type": {"0"}}},
		)
	case platformBilibili:
		identifier := bilibiliUserID(source)
		if identifier == "" {
			identifier, err = h.resolveIdentifier(ctx, cfg, "/api/v1/bilibili/web/fetch_get_user_id", url.Values{"share_link": {sourceURL}}, "uid", "user_id", "mid")
			if err != nil {
				return nil, err
			}
		}
		data, errs := h.tikhubMany(ctx, cfg, []upstreamCall{
			upstreamCall{"/api/v1/bilibili/web/fetch_user_profile", url.Values{"uid": {identifier}}},
			upstreamCall{"/api/v1/bilibili/web/fetch_user_post_videos", url.Values{"uid": {identifier}, "pn": {"1"}, "ps": {"12"}, "order": {"pubdate"}}},
			upstreamCall{"/api/v1/bilibili/web/fetch_user_relation_stat", url.Values{"uid": {identifier}}},
			upstreamCall{"/api/v1/bilibili/web/fetch_user_up_stat", url.Values{"uid": {identifier}}},
		})
		if errs[0] != nil && errs[1] != nil {
			return nil, errs[0]
		}
		profileData = []any{data[0], data[2], data[3]}
		worksData = data[1]
		if errs[0] != nil {
			extraWarnings = append(extraWarnings, "哔哩哔哩账号基础资料暂未返回，已尝试从作品补充")
		}
		if errs[2] != nil {
			extraWarnings = append(extraWarnings, "哔哩哔哩粉丝与关注统计暂未返回")
		}
		if errs[3] != nil {
			extraWarnings = append(extraWarnings, "哔哩哔哩获赞统计暂未返回")
		}
	case platformXiaohongshu:
		profileData, worksData, err = h.tikhubPair(ctx, cfg,
			upstreamCall{"/api/v1/xiaohongshu/app_v2/get_user_info", url.Values{"share_text": {sourceURL}}},
			upstreamCall{"/api/v1/xiaohongshu/app_v2/get_user_posted_notes", url.Values{"share_text": {sourceURL}}},
		)
	case platformYouTube:
		identifier := youtubeChannelID(source)
		if identifier == "" || strings.HasPrefix(identifier, "@") {
			identifier, err = h.resolveIdentifier(ctx, cfg, "/api/v1/youtube/web_v2/get_channel_id", url.Values{"channel_url": {sourceURL}}, "channel_id", "channelId", "id")
			if err != nil {
				return nil, err
			}
		}
		profileData, worksData, err = h.tikhubPair(ctx, cfg,
			upstreamCall{"/api/v1/youtube/web/get_channel_info", url.Values{"channel_id": {identifier}}},
			upstreamCall{"/api/v1/youtube/web/get_channel_videos_v2", url.Values{"channel_id": {identifier}, "lang": {"zh-CN"}, "sortBy": {"newest"}, "contentType": {"videos"}}},
		)
	case platformTikTok:
		identifier := tiktokUniqueID(source)
		if identifier == "" {
			return nil, &upstreamError{message: "TikTok 账号链接中缺少 @用户名"}
		}
		profileData, worksData, err = h.tikhubPair(ctx, cfg,
			upstreamCall{"/api/v1/tiktok/app/v3/handler_user_profile", url.Values{"unique_id": {identifier}}},
			upstreamCall{"/api/v1/tiktok/app/v3/fetch_user_post_videos_v3", url.Values{"unique_id": {identifier}, "max_cursor": {"0"}, "count": {"12"}, "sort_type": {"0"}}},
		)
	case platformKuaishou:
		identifier := pathSegmentAfter(source, "profile")
		if identifier == "" {
			identifier, err = h.resolveIdentifier(ctx, cfg, "/api/v1/kuaishou/web/fetch_get_user_id", url.Values{"share_link": {sourceURL}}, "user_id", "eid", "id")
			if err != nil {
				return nil, err
			}
		}
		profileData, worksData, err = h.tikhubPair(ctx, cfg,
			upstreamCall{"/api/v1/kuaishou/app/fetch_one_user_v2", url.Values{"user_id": {identifier}}},
			upstreamCall{"/api/v1/kuaishou/app/fetch_user_post_v2", url.Values{"user_id": {identifier}}},
		)
	}
	if err != nil {
		return nil, err
	}
	works := normalizeWorks(worksData)
	profile := normalizeProfile(profileData, worksData, true)
	if p == platformBilibili && profile != nil && profile.Works == "" {
		profile.Works = truncateText(directString(firstValue(worksData, "page"), "count"), 64)
	}
	warnings := append([]string{}, extraWarnings...)
	if profileData == nil {
		warnings = append(warnings, "账号资料暂未返回，已使用作品中的作者信息补充")
	}
	if worksData == nil {
		warnings = append(warnings, "近期作品暂未返回，本次只展示账号资料")
	} else if len(works) == 0 {
		warnings = append(warnings, "平台没有返回可展示的近期公开作品")
	}
	if profile == nil && len(works) == 0 {
		return nil, &upstreamError{message: "平台已响应，但返回结构中没有可识别的账号或作品信息"}
	}
	return &inspectVO{Profile: profile, Works: works, Warnings: warnings}, nil
}

func (h *handler) resolveIdentifier(ctx context.Context, cfg settings, path string, query url.Values, keys ...string) (string, error) {
	data, err := h.tikhubGet(ctx, cfg, path, query)
	if err != nil {
		return "", err
	}
	if value := scalarString(data); value != "" && !strings.Contains(value, "map[") {
		return value, nil
	}
	if value := firstString(data, keys...); value != "" {
		return value, nil
	}
	return "", &upstreamError{message: "平台未返回可识别的账号 ID"}
}

func (h *handler) tikhubGet(ctx context.Context, cfg settings, path string, query url.Values) (any, error) {
	base, err := url.Parse(cfg.baseURL)
	if err != nil || (base.Scheme != "https" && base.Scheme != "http") || base.Hostname() == "" || base.User != nil || base.RawQuery != "" || base.Fragment != "" {
		return nil, fmt.Errorf("invalid TikHub base URL")
	}
	target := strings.TrimRight(cfg.baseURL, "/") + path
	if encoded := query.Encode(); encoded != "" {
		target += "?" + encoded
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, target, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+cfg.apiKey)
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", "FlowingLight-SocialAnalysis/1.0")
	resp, err := h.httpcli.Do(req)
	if err != nil {
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
		return nil, &upstreamError{message: "无法连接 TikHub 服务，请稍后重试"}
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, maxUpstreamBody+1))
	if err != nil {
		return nil, &upstreamError{message: "读取 TikHub 响应失败，请稍后重试"}
	}
	if len(body) > maxUpstreamBody {
		return nil, &upstreamError{message: "平台响应过大"}
	}
	var envelope map[string]any
	decoder := json.NewDecoder(bytes.NewReader(body))
	decoder.UseNumber()
	decoderErr := decoder.Decode(&envelope)
	message := ""
	if decoderErr == nil {
		message = firstNonEmptyString(envelope, "message_zh", "message", "msg", "detail")
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		switch resp.StatusCode {
		case http.StatusUnauthorized, http.StatusForbidden:
			message = "TikHub 凭证无效或没有接口权限，请联系管理员检查配置"
		case http.StatusPaymentRequired:
			message = "TikHub 账户额度不足，请联系管理员处理"
		case http.StatusTooManyRequests:
			message = "TikHub 请求过于频繁，请稍后重试"
		default:
			if resp.StatusCode >= 500 {
				message = "TikHub 服务暂时不可用，请稍后重试"
			}
		}
		if message == "" {
			message = fmt.Sprintf("HTTP %d", resp.StatusCode)
		}
		return nil, &upstreamError{message: message}
	}
	if decoderErr != nil {
		return nil, &upstreamError{message: fmt.Sprintf("TikHub 返回了无法识别的数据（HTTP %d）", resp.StatusCode)}
	}
	if code := numericCode(envelope["code"]); code != 0 && code != http.StatusOK {
		if message == "" {
			message = "TikHub 请求未成功"
		}
		return nil, &upstreamError{message: message}
	}
	data, exists := envelope["data"]
	if !exists || data == nil {
		lower := strings.ToLower(message)
		if message == "" || strings.Contains(lower, "success") || strings.Contains(message, "请求成功") {
			message = "平台没有返回内容，请确认链接公开且有效"
		}
		return nil, &upstreamError{message: message}
	}
	if nested, ok := data.(map[string]any); ok {
		if code := numericCode(nested["status_code"]); code != 0 {
			nestedMessage := firstNonEmptyString(nested, "status_msg", "status_message", "message", "msg", "error")
			if nestedMessage == "" {
				nestedMessage = fmt.Sprintf("平台业务状态异常（%d）", code)
			}
			return nil, &upstreamError{message: nestedMessage}
		}
		if code := numericCode(nested["code"]); code != 0 && code != http.StatusOK {
			nestedMessage := firstNonEmptyString(nested, "message_zh", "message", "msg", "status_msg", "error")
			if nestedMessage == "" {
				nestedMessage = fmt.Sprintf("平台业务状态异常（%d）", code)
			}
			return nil, &upstreamError{message: nestedMessage}
		}
		if success, exists := nested["success"].(bool); exists && !success {
			nestedMessage := firstNonEmptyString(nested, "message_zh", "message", "msg", "error")
			if nestedMessage == "" {
				nestedMessage = "平台返回失败状态，请确认链接公开且有效"
			}
			return nil, &upstreamError{message: nestedMessage}
		}
	}
	return data, nil
}

func numericCode(value any) int {
	switch typed := value.(type) {
	case float64:
		return int(typed)
	case string:
		n, _ := strconv.Atoi(strings.TrimSpace(typed))
		return n
	case json.Number:
		n, _ := typed.Int64()
		return int(n)
	default:
		return 0
	}
}

func safeMessage(message string) string {
	message = strings.Join(strings.Fields(strings.TrimSpace(message)), " ")
	if len([]rune(message)) > 180 {
		return string([]rune(message)[:180]) + "…"
	}
	if message == "" {
		return "请检查链接是否公开且有效"
	}
	return message
}

func firstNonEmptyString(values map[string]any, keys ...string) string {
	for _, key := range keys {
		if value := scalarString(values[key]); value != "" {
			return value
		}
	}
	return ""
}

func pathSegments(u *url.URL) []string {
	parts := strings.Split(strings.Trim(u.EscapedPath(), "/"), "/")
	rows := make([]string, 0, len(parts))
	for _, part := range parts {
		if decoded, err := url.PathUnescape(part); err == nil && strings.TrimSpace(decoded) != "" {
			rows = append(rows, decoded)
		}
	}
	return rows
}

func pathSegmentAfter(u *url.URL, marker string) string {
	parts := pathSegments(u)
	for index := 0; index+1 < len(parts); index++ {
		if strings.EqualFold(parts[index], marker) {
			return strings.TrimSpace(parts[index+1])
		}
	}
	return ""
}

func bilibiliUserID(u *url.URL) string {
	if !strings.HasSuffix(strings.ToLower(u.Hostname()), "bilibili.com") {
		return ""
	}
	parts := pathSegments(u)
	if len(parts) == 0 {
		return ""
	}
	for _, char := range parts[0] {
		if char < '0' || char > '9' {
			return ""
		}
	}
	return parts[0]
}

func youtubeVideoID(u *url.URL) string {
	host := strings.ToLower(u.Hostname())
	var id string
	if host == "youtu.be" || strings.HasSuffix(host, ".youtu.be") {
		parts := pathSegments(u)
		if len(parts) > 0 {
			id = parts[0]
		}
	} else if value := u.Query().Get("v"); value != "" {
		id = value
	} else {
		for _, marker := range []string{"shorts", "embed", "live"} {
			if value := pathSegmentAfter(u, marker); value != "" {
				id = value
				break
			}
		}
	}
	if youtubeIDPattern.MatchString(id) {
		return id
	}
	return ""
}

func youtubeChannelID(u *url.URL) string {
	if value := pathSegmentAfter(u, "channel"); value != "" {
		return value
	}
	parts := pathSegments(u)
	if len(parts) > 0 && strings.HasPrefix(parts[0], "@") {
		return parts[0]
	}
	return ""
}

func tiktokUniqueID(u *url.URL) string {
	for _, part := range pathSegments(u) {
		if strings.HasPrefix(part, "@") && len(part) > 1 {
			return strings.TrimPrefix(part, "@")
		}
	}
	return ""
}
