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
	"tidecanvas/internal/handler/points"
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
	ExpectedPointCost *int   `json:"expectedPointCost" binding:"omitempty,min=1,max=100000"`
	ClientRequestID   string `json:"clientRequestId" binding:"max=100"`
	URL               string `json:"url" binding:"required"`
	Kind              string `json:"kind" binding:"required,oneof=content account"`
}

type statusVO struct {
	PointCost              int          `json:"pointCost"`
	Enabled                bool         `json:"enabled"`
	Configured             bool         `json:"configured"`
	VideoAnalysisSkillID   string       `json:"videoAnalysisSkillId"`
	ImageAnalysisSkillID   string       `json:"imageAnalysisSkillId"`
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
	Coin     string `json:"coin,omitempty"`
	Danmaku  string `json:"danmaku,omitempty"`
	Download string `json:"download,omitempty"`
}

type profileVO struct {
	ID        string             `json:"id,omitempty"`
	Name      string             `json:"name,omitempty"`
	Handle    string             `json:"handle,omitempty"`
	AvatarURL string             `json:"avatarUrl,omitempty"`
	PageURL   string             `json:"pageUrl,omitempty"`
	Bio       string             `json:"bio,omitempty"`
	Followers string             `json:"followers,omitempty"`
	Following string             `json:"following,omitempty"`
	Likes     string             `json:"likes,omitempty"`
	Works     string             `json:"works,omitempty"`
	Details   *platformDetailsVO `json:"details,omitempty"`
}

type workVO struct {
	Platform    platform           `json:"platform,omitempty"`
	Details     *platformDetailsVO `json:"details,omitempty"`
	ID          string             `json:"id,omitempty"`
	Title       string             `json:"title,omitempty"`
	Description string             `json:"description,omitempty"`
	CoverURL    string             `json:"coverUrl,omitempty"`
	ImageURLs   []string           `json:"imageUrls"`
	MediaURL    string             `json:"mediaUrl,omitempty"`
	MediaURLs   []string           `json:"mediaUrls"`
	PageURL     string             `json:"pageUrl,omitempty"`
	MediaType   string             `json:"mediaType,omitempty"`
	Duration    string             `json:"duration,omitempty"`
	PublishedAt string             `json:"publishedAt,omitempty"`
	Stats       metricVO           `json:"stats"`
}

type inspectVO struct {
	PointCost    int        `json:"pointCost"`
	RecordID     idgen.ID   `json:"recordId,omitempty"`
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
	downloader videoDownloader
	// A second request for the same ticket must not run another transcode or
	// turn the first request's still-active history record into a failure.
	activeDownloads sync.Map
}

type upstreamError struct {
	message    string
	status     int
	httpStatus int
	requestID  string
}

func (e *upstreamError) Error() string { return e.message }

// Register mounts the social-analysis workbench API.
func Register(api *gin.RouterGroup, d *app.Deps) {
	h := &handler{
		db:      d.DB,
		httpcli: newTikHubHTTPClient(),
	}
	if d.Cfg != nil {
		h.downloader = newLocalVideoDownloader(d.Cfg.VideoDownloader, h.resolveDouyinDownload)
	}
	api.GET("/social-analysis/downloader/download/:token", videoDownloadTicketAuth(), h.downloadVideo)
	api.GET("/social-analysis/downloader/preview", h.previewVideo)
	g := api.Group("/social-analysis")
	g.Use(middleware.JWTAuth(d))
	g.GET("/status", h.status)
	g.GET("/records", h.activityRecords)
	g.GET("/records/:id", h.activityRecordDetail)
	g.GET("/downloader/platforms", h.downloaderPlatforms)
	g.POST("/downloader/resolve", middleware.RateLimit(d, 15, time.Minute), h.resolveVideoDownload)
	g.POST("/inspect", middleware.RateLimit(d, 20, time.Minute), h.inspect)
	go func() {
		h.reconcileCharges()
		for range time.NewTicker(time.Minute).C {
			h.reconcileCharges()
		}
	}()
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
	return h.loadSettingsContext(context.Background())
}

func (h *handler) loadSettingsContext(ctx context.Context) (settings, error) {
	var rows []model.SysConfig
	if err := h.db.WithContext(ctx).Where("config_key IN ?", model.SocialAnalysisConfigKeys).Find(&rows).Error; err != nil {
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
	price, priceErr := points.SocialPrice(h.db, model.SocialActivityAnalysis)
	if priceErr != nil {
		writeChargeError(c, priceErr)
		return
	}
	cfg, err := h.loadSettings()
	if err != nil {
		response.Fail(c, response.CodeServerError, "failed to load social analysis settings")
		return
	}
	var videoAnalysisSkillID idgen.ID
	var imageAnalysisSkillID idgen.ID
	var accountAnalysisSkillID idgen.ID
	h.db.Model(&model.Skill{}).
		Where("seed_key = ? AND status = 1", "tool-video-analysis").
		Limit(1).Pluck("id", &videoAnalysisSkillID)
	h.db.Model(&model.Skill{}).
		Where("seed_key = ? AND status = 1", "tool-image-analysis").
		Limit(1).Pluck("id", &imageAnalysisSkillID)
	h.db.Model(&model.Skill{}).
		Where("seed_key = ? AND status = 1", "tool-account-analysis").
		Limit(1).Pluck("id", &accountAnalysisSkillID)
	response.OK(c, statusVO{
		PointCost: price,
		Enabled:   cfg.enabled, Configured: cfg.apiKey != "",
		VideoAnalysisSkillID: skillIDString(videoAnalysisSkillID), ImageAnalysisSkillID: skillIDString(imageAnalysisSkillID),
		AccountAnalysisSkillID: skillIDString(accountAnalysisSkillID),
		Platforms:              supportedPlatforms(),
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
	activity := &model.SocialActivityRecord{
		UserID: middleware.CurrentUserID(c), ActivityType: model.SocialActivityAnalysis,
		Kind: dto.Kind, Platform: string(p), SourceURL: parsed.String(), Status: model.SocialActivityProcessing,
	}
	cfg, err := h.loadSettings()
	if err != nil {
		h.failActivity(activity, "读取内容拆解配置失败")
		response.Fail(c, response.CodeServerError, "failed to load social analysis settings")
		return
	}
	if !cfg.enabled {
		h.failActivity(activity, "内容拆解功能暂未开放")
		response.Fail(c, response.CodeToolDisabled, "内容拆解功能暂未开放")
		return
	}
	if cfg.apiKey == "" {
		h.failActivity(activity, "内容拆解服务尚未配置")
		response.Fail(c, response.CodeToolDisabled, "内容拆解服务尚未配置，请联系管理员配置 TikHub API Key")
		return
	}
	existed, chargeErr := points.BeginSocial(h.db, activity, dto.ClientRequestID, dto.ExpectedPointCost)
	if chargeErr != nil {
		writeChargeError(c, chargeErr)
		return
	}
	if existed {
		replaySocial(c, activity)
		return
	}
	defer h.failActivity(activity, "内容拆解未完成，积分已退回")
	ctx, cancel := context.WithTimeout(c.Request.Context(), 8*time.Minute)
	defer cancel()

	var result *inspectVO
	if dto.Kind == "account" {
		result, err = h.inspectAccount(ctx, cfg, p, parsed)
	} else {
		result, err = h.inspectContent(ctx, cfg, p, parsed)
	}
	if err != nil {
		logger.L().Warn("social analysis inspect failed",
			zap.String("platform", string(p)), zap.String("kind", dto.Kind), zap.Error(err))
		var upstream *upstreamError
		if errors.As(err, &upstream) {
			message := "平台解析失败：" + safeMessage(upstream.message)
			h.failActivity(activity, message)
			response.Fail(c, response.CodeBadRequest, message)
			return
		}
		h.failActivity(activity, "内容拆解服务暂时不可用")
		response.Fail(c, response.CodeServerError, "social analysis upstream request failed")
		return
	}
	result.PointCost = activity.PointCost
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
	if activity != nil {
		result.RecordID = activity.ID
	}
	completedAt := time.Now()
	activityUpdate := map[string]any{
		"status": model.SocialActivitySucceeded, "title": inspectActivityTitle(result),
		"error_message": "", "completed_at": completedAt,
	}
	if snapshot, marshalErr := json.Marshal(result); marshalErr == nil && len(snapshot) <= 4<<20 {
		activityUpdate["snapshot_json"] = string(snapshot)
	} else if marshalErr != nil {
		logger.L().Warn("failed to marshal social analysis snapshot", zap.Error(marshalErr))
		response.Fail(c, response.CodeServerError, "分析结果保存失败")
		return
	} else {
		logger.L().Warn("social analysis snapshot exceeds storage limit", zap.Int("bytes", len(snapshot)))
		response.Fail(c, response.CodeBadRequest, "分析结果过大，请缩小范围后重试，积分已退回")
		return
	}
	updated := h.db.Model(activity).Where("status = ? AND refunded = ?", model.SocialActivityProcessing, false).Updates(activityUpdate)
	if updated.Error != nil || updated.RowsAffected != 1 {
		response.Fail(c, response.CodeServerError, "分析结果保存失败")
		return
	}
	response.OK(c, result)
}

func inspectActivityTitle(result *inspectVO) string {
	if result == nil {
		return "内容分析"
	}
	if result.Kind == "account" && result.Profile != nil {
		if title := activityString(result.Profile.Name, 200); title != "" {
			return title
		}
		if title := activityString(result.Profile.Handle, 200); title != "" {
			return title
		}
	}
	if result.Content != nil {
		if title := activityString(result.Content.Title, 200); title != "" {
			return title
		}
	}
	label := strings.TrimSpace(result.PlatformName)
	if label == "" {
		label = "平台"
	}
	if result.Kind == "account" {
		return label + "账号分析"
	}
	return label + "作品分析"
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
	ctx, cancel := context.WithTimeout(ctx, 55*time.Second)
	defer cancel()
	var data any
	var err error
	warnings := []string{}
	sourceURL := source.String()
	switch p {
	case platformDouyin:
		return h.inspectDouyinContent(ctx, cfg, source)
	case platformBilibili:
		return h.inspectBilibiliContent(ctx, cfg, source)
	case platformXiaohongshu:
		data, err = h.tikhubGet(ctx, cfg, "/api/v1/xiaohongshu/app_v2/get_image_note_detail", url.Values{"share_text": {sourceURL}})
		note := normalizePlatformWork(p, data, sourceURL)
		if err == nil && note.MediaType == "video" && note.MediaURL == "" {
			videoData, videoErr := h.tikhubGet(ctx, cfg, "/api/v1/xiaohongshu/app_v2/get_video_note_detail", url.Values{"share_text": {sourceURL}})
			video := normalizePlatformWork(p, videoData, sourceURL)
			if videoErr == nil && note.ID != "" && video.ID == note.ID && video.MediaURL != "" {
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
			if primary == nil {
				primary = map[string]any{"video_id": videoID}
			}
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
	content := normalizePlatformWork(p, data, sourceURL)
	if !workHasData(content) {
		return nil, &upstreamError{message: "平台已响应，但返回结构中没有可识别的作品信息"}
	}
	profile := platformProfile(p, data, nil, false)
	return &inspectVO{Profile: profile, Content: &content, Works: []workVO{}, Warnings: warnings}, nil
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
	ctx, cancel := context.WithTimeout(ctx, 55*time.Second)
	defer cancel()
	sourceURL := source.String()
	var profileData, worksData any
	var err error
	resolvedIdentifier := ""
	extraWarnings := []string{}
	switch p {
	case platformDouyin:
		return h.inspectDouyinAccount(ctx, cfg, source)
	case platformBilibili:
		identifier := bilibiliUserID(source)
		if identifier == "" {
			identifier, err = h.resolveIdentifier(ctx, cfg, "/api/v1/bilibili/web/fetch_get_user_id", url.Values{"share_link": {sourceURL}}, "uid", "user_id", "mid")
			if err != nil {
				return nil, err
			}
		}
		resolvedIdentifier = identifier
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
		resolvedIdentifier = identifier
		profileData, worksData, err = h.tikhubPair(ctx, cfg,
			upstreamCall{"/api/v1/youtube/web/get_channel_info", url.Values{"channel_id": {identifier}}},
			upstreamCall{"/api/v1/youtube/web_v2/get_channel_videos", url.Values{"channel_id": {identifier}, "language_code": {"zh-CN"}, "need_format": {"true"}}},
		)
	case platformTikTok:
		identifier := tiktokUniqueID(source)
		if identifier == "" {
			return nil, &upstreamError{message: "TikTok 账号链接中缺少 @用户名"}
		}
		resolvedIdentifier = identifier
		profileData, worksData, err = h.tikhubPair(ctx, cfg,
			upstreamCall{"/api/v1/tiktok/app/v3/handler_user_profile", url.Values{"unique_id": {identifier}}},
			upstreamCall{"/api/v1/tiktok/app/v3/fetch_user_post_videos", url.Values{"unique_id": {identifier}, "max_cursor": {"0"}, "count": {"12"}, "sort_type": {"0"}}},
		)
	case platformKuaishou:
		identifier := pathSegmentAfter(source, "profile")
		if identifier == "" {
			identifier, err = h.resolveIdentifier(ctx, cfg, "/api/v1/kuaishou/web/fetch_get_user_id", url.Values{"share_link": {sourceURL}}, "user_id", "eid", "id")
			if err != nil {
				return nil, err
			}
		}
		resolvedIdentifier = identifier
		profileData, worksData, err = h.tikhubPair(ctx, cfg,
			upstreamCall{"/api/v1/kuaishou/app/fetch_one_user_v2", url.Values{"user_id": {identifier}}},
			upstreamCall{"/api/v1/kuaishou/app/fetch_user_post_v2", url.Values{"user_id": {identifier}}},
		)
	}
	if err != nil {
		return nil, err
	}
	works := normalizePlatformWorks(p, worksData)
	profile := platformProfile(p, profileData, worksData, true)
	if missing := h.enrichAccountWorks(ctx, cfg, p, works); missing > 0 {
		extraWarnings = append(extraWarnings, fmt.Sprintf("%d 条作品未能补齐详情，已保留列表数据；缺失指标不按 0 计算", missing))
	}
	if profile != nil && profile.ID == "" && resolvedIdentifier != "" {
		profile.ID = truncateText(resolvedIdentifier, 256)
	}
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

func (h *handler) tikhubGet(ctx context.Context, cfg settings, path string, query url.Values) (result any, resultErr error) {
	var httpStatus int
	var requestID string
	defer func() {
		var upstream *upstreamError
		if errors.As(resultErr, &upstream) {
			upstream.httpStatus = httpStatus
			upstream.requestID = tikHubSafeDiagnostic(requestID, cfg.apiKey)
			upstream.message = tikHubSafeDiagnostic(upstream.message, cfg.apiKey)
		}
	}()
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
	httpStatus = resp.StatusCode
	requestID = resp.Header.Get("X-Request-ID")
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
		message = tikHubResponseMessage(envelope, 0)
		if value := tikHubResponseRequestID(envelope); value != "" {
			requestID = value
		}
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		message = tikHubStatusMessage(resp.StatusCode, message)
		if resp.StatusCode >= 500 {
			message = "TikHub 服务暂时不可用，请稍后重试"
		}
		if message == "" {
			message = fmt.Sprintf("HTTP %d", resp.StatusCode)
		}
		return nil, &upstreamError{message: message, status: resp.StatusCode}
	}
	if decoderErr != nil {
		return nil, &upstreamError{message: fmt.Sprintf("TikHub 返回了无法识别的数据（HTTP %d）", resp.StatusCode)}
	}
	if code := numericCode(envelope["code"]); code != 0 && code != http.StatusOK {
		message = tikHubStatusMessage(code, message)
		if message == "" {
			message = "TikHub 请求未成功"
		}
		return nil, &upstreamError{message: message, status: code}
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

func tikHubStatusMessage(status int, message string) string {
	switch status {
	case http.StatusUnauthorized, http.StatusForbidden:
		return "TikHub 凭证无效或没有接口权限，请联系管理员检查配置"
	case http.StatusPaymentRequired:
		return "TikHub 账户额度不足，请联系管理员处理"
	case http.StatusTooManyRequests:
		return "TikHub 请求过于频繁，请稍后重试"
	default:
		return message
	}
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
