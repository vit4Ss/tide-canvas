package social

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"mime"
	"net/http"
	"net/url"
	"path"
	"regexp"
	"strconv"
	"strings"

	"time"
	"unicode/utf8"

	"github.com/gin-gonic/gin"
	"go.uber.org/zap"
	"tidecanvas/internal/handler/points"

	"tidecanvas/internal/middleware"
	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/idgen"
	"tidecanvas/internal/pkg/logger"
	"tidecanvas/internal/pkg/response"

	"tidecanvas/internal/pkg/token"
)

const (
	maxDownloaderInputBody = 16 << 10
	maxVideoDownloadBytes  = int64(2 << 30)
	videoDownloadTicketMax = 5 * time.Minute
	videoDownloadMaxTime   = time.Hour
)

var videoDownloadTokenPattern = regexp.MustCompile(`^[A-Za-z0-9._~-]{1,512}$`)

type downloaderCapabilitiesVO struct {
	PointCost       int      `json:"pointCost"`
	Enabled         bool     `json:"enabled"`
	Platforms       []string `json:"platforms"`
	MaxFileBytes    int64    `json:"maxFileBytes"`
	TokenTTLSeconds int      `json:"tokenTtlSeconds"`
}

type videoDownloadResolveDTO struct {
	ExpectedPointCost *int   `json:"expectedPointCost" binding:"omitempty,min=1,max=100000"`
	ClientRequestID   string `json:"clientRequestId" binding:"max=100"`
	URL               string `json:"url" binding:"required"`
	Quality           string `json:"quality"`
}

type videoDownloadResolveVO struct {
	PointCost       int      `json:"pointCost"`
	ID              string   `json:"id"`
	Platform        string   `json:"platform"`
	Title           string   `json:"title"`
	DurationSeconds int      `json:"durationSeconds"`
	Width           int      `json:"width"`
	Height          int      `json:"height"`
	EstimatedBytes  int64    `json:"estimatedBytes"`
	Quality         string   `json:"quality"`
	ExpiresAt       int64    `json:"expiresAt"`
	FileName        string   `json:"fileName"`
	DownloadURL     string   `json:"downloadUrl"`
	RecordID        idgen.ID `json:"recordId,omitempty"`
	// CoverURL 是上游可能附带的封面直链,仅用于前端展示确认。上游不给就是空串,
	// 前端有兜底版式,不影响下载本身。
	CoverURL      string `json:"coverUrl,omitempty"`
	PreviewURL    string `json:"previewUrl,omitempty"`
	previewSource string
}

// Metadata is signed together with the paid execution ID. The durable record
// owns billing and one transfer; callers cannot replace the source or owner.
type videoDownloadActivity struct {
	SourceURL       string `json:"u"`
	Platform        string `json:"p"`
	Title           string `json:"t"`
	Quality         string `json:"q"`
	DurationSeconds int    `json:"d"`
	Width           int    `json:"w"`
	Height          int    `json:"h"`
	EstimatedBytes  int64  `json:"b"`
	ExpiresAt       int64  `json:"e"`
}

type videoDownloader interface {
	platforms(context.Context) (downloaderCapabilitiesVO, error)
	resolve(context.Context, string, string) (videoDownloadResolveVO, error)
	download(context.Context, string, string) (*http.Response, error)
}

type videoDownloaderError struct {
	status   int
	code     string
	message  string
	authored bool
}

func (e *videoDownloaderError) Error() string { return e.message }

func decodeVideoDownloaderError(resp *http.Response) error {
	if resp != nil && resp.Body != nil {
		resp.Body.Close()
	}
	return &videoDownloaderError{status: http.StatusBadGateway, message: "下载结果不是有效视频，请重新解析后重试", authored: true}
}

// displayImageURL 从若干候选里挑第一个可以安全交给浏览器 <img> 的地址。
// 只放行 https、无凭证、无自定义端口、长度受限的地址:这个值会原样进页面,
// 拿不到就返回空串让前端走兜底版式。
func displayImageURL(candidates ...string) string {
	for _, candidate := range candidates {
		candidate = strings.TrimSpace(candidate)
		if candidate == "" || len(candidate) > 2048 {
			continue
		}
		parsed, err := url.ParseRequestURI(candidate)
		if err != nil || parsed.Scheme != "https" || parsed.Hostname() == "" ||
			parsed.User != nil || parsed.Port() != "" || parsed.Fragment != "" {
			continue
		}
		return parsed.String()
	}
	return ""
}

func (h *handler) downloaderPlatforms(c *gin.Context) {
	if h.downloader == nil {
		response.OK(c, downloaderCapabilitiesVO{Platforms: []string{}})
		return
	}
	capabilities, err := h.downloader.platforms(c.Request.Context())
	if err != nil {
		writeVideoDownloaderError(c, err)
		return
	}
	price, err := points.SocialPrice(h.db, model.SocialActivityDownload)
	if err != nil {
		writeChargeError(c, err)
		return
	}
	capabilities.PointCost = price
	response.OK(c, capabilities)
}

// writeVideoDownloaderError 把本地下载器的失败翻译成用户看得懂、且能据此行动的
// 提示。注意 response.Fail 对 CodeServerError 会强制抹成统一话术「请联系客服」
// (见 response.Fail 的注释),所以凡是我们已经有像样文案的情形都不能走 500——
// 否则文案是死代码,用户面对一句无从下手的话。只有真正的内部错误才留给 500。
func writeVideoDownloaderError(c *gin.Context, err error) {
	var upstream *videoDownloaderError
	if errors.As(err, &upstream) {
		switch {
		case upstream.status == http.StatusBadRequest:
			message := safeMessage(upstream.message)
			if upstream.code == "bad_request" || strings.Contains(strings.ToLower(upstream.message), "not publicly accessible") {
				message = "视频无法公开访问：可能已删除、受地区限制、需要登录，或链接类型不受支持"
			}
			response.Fail(c, response.CodeBadRequest, message)
		case upstream.status == http.StatusNotFound:
			response.Fail(c, response.CodeNotFound, "下载令牌不存在或已过期，请重新解析")
		case upstream.status == http.StatusTooManyRequests:
			response.Fail(c, response.CodeRateLimited, "视频下载请求过于频繁，请稍后重试")
		case upstream.status == http.StatusUnauthorized || upstream.status == http.StatusForbidden:
			// 我方凭证问题,用户重试多少次都没用,直接指向管理员。
			logger.L().Warn("local video downloader rejected our credentials",
				zap.Int("status", upstream.status), zap.String("code", upstream.code), zap.String("message", upstream.message))
			response.Fail(c, response.CodeToolDisabled, "视频平台拒绝了下载请求，请确认视频可以公开访问")
		case upstream.status >= http.StatusInternalServerError:
			// 上游 5xx 与网络故障:用户稍后重试或换个链接就可能成功,这是明确的
			// 下一步,不是「联系客服」。真实原因照旧落日志供排查。
			logger.L().Warn("local video downloader upstream failure",
				zap.Int("status", upstream.status), zap.String("code", upstream.code), zap.String("message", upstream.message))
			message := "视频解析服务暂时不可用，请稍后重试；若同一链接持续失败，多半是该视频暂不支持解析"
			if upstream.authored && upstream.message != "" {
				message = upstream.message
			}
			response.Fail(c, response.CodeToolDisabled, message)
		case upstream.status >= http.StatusBadRequest:
			// 其余 4xx(如 402/415/422)基本都在说这条链接本身的问题,原文比兜底话术有用。
			logger.L().Warn("local video downloader rejected the source",
				zap.Int("status", upstream.status), zap.String("code", upstream.code), zap.String("message", upstream.message))
			response.Fail(c, response.CodeBadRequest, safeMessage(upstream.message))
		default:
			// 2xx/3xx 却带着错误体:上游违反了自己的契约,不是用户能处理的情形,
			// 保持 500(真实原因由 response.Fail 落日志)。下载流的 JSON 冒充视频
			// 走的正是这一支,不能降级成 4xx。
			response.Fail(c, response.CodeServerError, upstream.message)
		}
		return
	}
	response.Fail(c, response.CodeServerError, err.Error())
}

func validPublicDownloadSource(raw string) string {
	raw = strings.TrimSpace(raw)
	if len(raw) == 0 || len(raw) > maxSourceURLLength || strings.Contains(raw, "#") {
		return ""
	}
	parsed, err := url.ParseRequestURI(raw)
	if err != nil || parsed.Scheme != "https" || parsed.Hostname() == "" || parsed.User != nil || parsed.Port() != "" || parsed.Fragment != "" {
		return ""
	}
	return parsed.String()
}

func downloadActivityError(err error) string {
	var upstream *videoDownloaderError
	if errors.As(err, &upstream) {
		if upstream.authored {
			return activityString(upstream.message, 1000)
		}
		switch upstream.status {
		case http.StatusNotFound:
			return "下载地址不存在或已过期"
		case http.StatusTooManyRequests:
			return "视频下载请求过于频繁"
		case http.StatusBadRequest:
			return "视频无法公开访问或链接不受支持"
		}
	}
	return "视频下载服务暂时不可用"
}

func (h *handler) resolveVideoDownload(c *gin.Context) {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxDownloaderInputBody)
	var dto videoDownloadResolveDTO
	if err := c.ShouldBindJSON(&dto); err != nil {
		response.Fail(c, response.CodeBadRequest, "请输入有效的公开视频链接")
		return
	}
	sourceURL := validPublicDownloadSource(dto.URL)
	if sourceURL == "" {
		response.Fail(c, response.CodeBadRequest, "仅支持不含自定义端口的公开视频 HTTPS 链接")
		return
	}
	quality := strings.ToLower(strings.TrimSpace(dto.Quality))
	if quality == "" {
		quality = "compat"
	}
	if quality != "quality" && quality != "compat" && quality != "speed" {
		response.Fail(c, response.CodeBadRequest, "下载质量只能是 quality、compat 或 speed")
		return
	}
	if h.downloader == nil {
		response.Fail(c, response.CodeToolDisabled, "视频下载组件尚未就绪，请联系管理员检查下载服务")
		return
	}
	capabilities, err := h.downloader.platforms(c.Request.Context())
	if err != nil {
		writeVideoDownloaderError(c, err)
		return
	}
	if !capabilities.Enabled {
		response.Fail(c, response.CodeToolDisabled, "视频下载服务当前未启用")
		return
	}
	activity := &model.SocialActivityRecord{UserID: middleware.CurrentUserID(c), ActivityType: model.SocialActivityDownload, SourceURL: sourceURL, Quality: quality, Status: model.SocialActivityProcessing}
	existed, chargeErr := points.BeginSocial(h.db, activity, dto.ClientRequestID, dto.ExpectedPointCost)
	if chargeErr != nil {
		writeChargeError(c, chargeErr)
		return
	}
	if existed {
		replaySocial(c, activity)
		return
	}
	prepared := false
	defer func() {
		if !prepared {
			h.failActivity(activity, "视频解析未完成，积分已退回")
		}
	}()
	ctx, cancel := context.WithTimeout(c.Request.Context(), 4*time.Minute)
	defer cancel()
	resolved, err := h.downloader.resolve(ctx, sourceURL, quality)
	if err != nil {
		writeVideoDownloaderError(c, err)
		return
	}
	platformAllowed := false
	for _, enabledPlatform := range capabilities.Platforms {
		if enabledPlatform == resolved.Platform {
			platformAllowed = true
			break
		}
	}
	if !platformAllowed {
		response.Fail(c, response.CodeToolDisabled, "该平台的视频下载渠道当前未启用")
		return
	}
	if resolved.EstimatedBytes > 0 && capabilities.MaxFileBytes > 0 && resolved.EstimatedBytes > capabilities.MaxFileBytes {
		response.Fail(c, response.CodeBadRequest, "视频预计大小超过当前单文件下载上限")
		return
	}
	remaining := time.Until(time.Unix(resolved.ExpiresAt, 0))
	if remaining <= 10*time.Second {
		response.Fail(c, response.CodeBadRequest, "视频解析令牌即将过期，请重新解析")
		return
	}
	ttl := videoDownloadTicketMax
	if remaining < ttl {
		ttl = remaining
	}
	name := downloadVideoFileName(resolved.Title)
	recordID := activity.ID
	expiresAt := time.Now().Add(ttl)
	metadataJSON, _ := json.Marshal(videoDownloadActivity{
		SourceURL: sourceURL, Platform: resolved.Platform, Title: activityString(resolved.Title, 256),
		Quality: resolved.Quality, DurationSeconds: resolved.DurationSeconds,
		Width: resolved.Width, Height: resolved.Height, EstimatedBytes: resolved.EstimatedBytes,
		ExpiresAt: expiresAt.Unix(),
	})
	metadata := base64.RawURLEncoding.EncodeToString(metadataJSON)
	ticket, err := token.IssueDownloadTicket(middleware.CurrentUserID(c), middleware.CurrentRole(c), videoActivityResource(resolved.ID, recordID, metadata), name, ttl)
	if err != nil {
		response.Fail(c, response.CodeServerError, "failed to issue video download ticket")
		return
	}
	query := url.Values{"ticket": {ticket}, "name": {name}, "record": {recordID.String()}, "meta": {metadata}}
	resolved.ExpiresAt = expiresAt.Unix()
	resolved.FileName = name
	resolved.RecordID = recordID
	resolved.DownloadURL = "/api/social-analysis/downloader/download/" + url.PathEscape(resolved.ID) + "?" + query.Encode()
	resolved.PreviewURL = ""
	// Playback uses the file already delivered to the browser. Issuing a
	// standalone full-video preview here would let an unused reservation be
	// refunded after its video had already been consumed via the preview URL.
	// Avoid issuing a URL that common reverse proxies cannot accept.
	if len(metadata) > 8192 || len(resolved.DownloadURL) > 7500 {
		response.Fail(c, response.CodeBadRequest, "视频链接或标题过长，请使用简短的作品链接重新解析")
		return
	}
	resolved.PointCost = activity.PointCost
	snapshot, err := json.Marshal(resolved)
	if err != nil {
		writeChargeError(c, err)
		return
	}
	updated := h.db.Model(activity).Where("status = ? AND refunded = ?", model.SocialActivityProcessing, false).Updates(map[string]any{
		"status": model.SocialActivityReady, "title": activityString(resolved.Title, 256), "platform": resolved.Platform,
		"duration_seconds": resolved.DurationSeconds, "width": resolved.Width, "height": resolved.Height,
		"estimated_bytes": resolved.EstimatedBytes, "expires_at": expiresAt, "snapshot_json": string(snapshot),
	})
	if updated.Error != nil {
		writeChargeError(c, updated.Error)
		return
	}
	if updated.RowsAffected != 1 {
		writeChargeError(c, points.ErrSocialUnavailable)
		return
	}
	prepared = true
	response.OK(c, resolved)
}

func videoActivityResource(id string, recordID idgen.ID, metadata string) string {
	resource := videoTicketResource(id, recordID)
	if metadata != "" {
		resource += ":meta:" + metadata
	}
	return resource
}

func videoTicketResource(id string, recordIDs ...idgen.ID) string {
	resource := "relay-video-download:" + id
	if len(recordIDs) > 0 && recordIDs[0] != 0 {
		resource += ":" + recordIDs[0].String()
	}
	return resource
}

func downloadVideoFileName(title string) string {
	title = strings.TrimSpace(title)
	if title == "" {
		title = "公开视频"
	}
	title = strings.Map(func(r rune) rune {
		if r < 0x20 || strings.ContainsRune(`<>:"/\|?*`, r) {
			return '-'
		}
		return r
	}, title)
	if utf8.RuneCountInString(title) > 120 {
		title = string([]rune(title)[:120])
	}
	if !strings.EqualFold(path.Ext(title), ".mp4") {
		title = strings.TrimSuffix(title, path.Ext(title)) + ".mp4"
	}
	return title
}

func videoDownloadTicketAuth() gin.HandlerFunc {
	return func(c *gin.Context) {
		id := strings.TrimSpace(c.Param("token"))
		name := strings.TrimSpace(c.Query("name"))
		ticket := strings.TrimSpace(c.Query("ticket"))
		metadata := strings.TrimSpace(c.Query("meta"))
		recordID := idgen.ID(0)
		if rawRecordID := strings.TrimSpace(c.Query("record")); rawRecordID != "" {
			parsedRecordID, err := idgen.Parse(rawRecordID)
			if err != nil || parsedRecordID == 0 {
				response.Fail(c, response.CodeUnauthorized, "下载地址无效或已过期，请重新解析")
				c.Abort()
				return
			}
			recordID = parsedRecordID
		}
		if !videoDownloadTokenPattern.MatchString(id) || len(ticket) == 0 || len(ticket) > 4096 || len(metadata) > 8192 || utf8.RuneCountInString(name) > 140 {
			response.Fail(c, response.CodeUnauthorized, "下载地址无效或已过期，请重新解析")
			c.Abort()
			return
		}
		claims, err := token.ParseDownloadTicket(ticket, videoActivityResource(id, recordID, metadata), name)
		if err != nil {
			response.Fail(c, response.CodeUnauthorized, "下载地址无效或已过期，请重新解析")
			c.Abort()
			return
		}
		if metadata != "" {
			decoded, decodeErr := base64.RawURLEncoding.DecodeString(metadata)
			var preview videoDownloadActivity
			if decodeErr != nil || recordID == 0 || json.Unmarshal(decoded, &preview) != nil || validPublicDownloadSource(preview.SourceURL) == "" {
				response.Fail(c, response.CodeUnauthorized, "下载信息无效，请重新解析")
				c.Abort()
				return
			}
			c.Set("socialDownloadActivity", preview)
		}
		c.Set(middleware.CtxUserID, claims.UserID)
		c.Set(middleware.CtxRole, claims.Role)
		c.Set(middleware.CtxJTI, claims.ID)
		c.Set("socialDownloadRecordID", recordID)
		c.Header("Cache-Control", "private, no-store")
		c.Header("Referrer-Policy", "no-referrer")
		c.Next()
	}
}

func (h *handler) downloadVideo(c *gin.Context) {
	name := downloadVideoFileName(c.Query("name"))
	recordID, _ := c.Get("socialDownloadRecordID")
	activity := &model.SocialActivityRecord{UserID: middleware.CurrentUserID(c)}
	if typed, ok := recordID.(idgen.ID); ok {
		activity.ID = typed
	}
	if activity.ID == 0 {
		activity = nil
	}
	if activity != nil {
		key := [2]idgen.ID{activity.UserID, activity.ID}
		if _, active := h.activeDownloads.LoadOrStore(key, struct{}{}); active {
			response.Fail(c, response.CodeRateLimited, "视频正在准备或下载中，请等待当前任务完成")
			return
		}
		defer h.activeDownloads.Delete(key)
	}
	if activity == nil || h.db == nil {
		response.Fail(c, response.CodeBadRequest, "下载凭证已失效，请重新发起下载")
		return
	}
	if err := h.db.Where("id = ? AND user_id = ? AND activity_type = ?", activity.ID, activity.UserID, model.SocialActivityDownload).First(activity).Error; err != nil {
		response.Fail(c, response.CodeNotFound, "下载记录不存在，请重新发起下载")
		return
	}
	// One paid ticket can start one attachment transfer across all instances.
	claimed := h.db.Model(activity).Where("status = ? AND point_cost > 0 AND refunded = ? AND expires_at > ?", model.SocialActivityReady, false, time.Now()).
		Updates(map[string]any{"status": model.SocialActivityDownloading, "error_message": "", "completed_at": nil})
	if claimed.Error != nil {
		writeChargeError(c, claimed.Error)
		return
	}
	if claimed.RowsAffected != 1 {
		writeChargeError(c, points.ErrSocialUnavailable)
		return
	}
	defer h.failActivity(activity, "下载未完成，积分已退回")
	if h.downloader == nil {
		h.failActivity(activity, "视频下载服务尚未配置")
		response.Fail(c, response.CodeToolDisabled, "视频下载服务尚未配置")
		return
	}
	downloadCtx, cancel := context.WithTimeout(c.Request.Context(), videoDownloadMaxTime)
	defer cancel()
	var sourceURL, quality string
	if raw, ok := c.Get("socialDownloadActivity"); ok {
		preview := raw.(videoDownloadActivity)
		sourceURL, quality = preview.SourceURL, preview.Quality
	} else if activity != nil {
		// Existing signed tickets with database-backed metadata remain usable
		// across the migration; no request is sent to the previous Relay.
		sourceURL, quality = activity.SourceURL, activity.Quality
	}
	if sourceURL == "" {
		h.failActivity(activity, "下载信息已失效，请重新解析")
		response.Fail(c, response.CodeBadRequest, "下载信息已失效，请重新解析")
		return
	}
	resp, err := h.downloader.download(downloadCtx, sourceURL, quality)
	if err != nil {
		h.failActivity(activity, downloadActivityError(err))
		writeVideoDownloaderError(c, err)
		return
	}
	if resp.StatusCode != http.StatusOK {
		upstreamErr := decodeVideoDownloaderError(resp)
		h.failActivity(activity, downloadActivityError(upstreamErr))
		writeVideoDownloaderError(c, upstreamErr)
		return
	}
	defer resp.Body.Close()
	if resp.ContentLength > maxVideoDownloadBytes {
		h.failActivity(activity, "视频文件超过本站下载上限")
		response.Fail(c, response.CodeBadRequest, "视频文件超过本站下载上限")
		return
	}
	contentType := strings.TrimSpace(resp.Header.Get("Content-Type"))
	mediaType := strings.ToLower(strings.TrimSpace(strings.SplitN(contentType, ";", 2)[0]))
	if mediaType == "application/json" || strings.HasSuffix(mediaType, "+json") || strings.HasPrefix(mediaType, "text/") {
		upstreamErr := decodeVideoDownloaderError(resp)
		h.failActivity(activity, downloadActivityError(upstreamErr))
		writeVideoDownloaderError(c, upstreamErr)
		return
	}
	if resp.ContentLength == 0 {
		h.failActivity(activity, "视频文件为空")
		response.Fail(c, response.CodeNotFound, "视频文件为空，请重新解析")
		return
	}
	if contentType == "" {
		contentType = "video/mp4"
	}
	disposition := mime.FormatMediaType("attachment", map[string]string{"filename": name})
	if disposition == "" {
		disposition = "attachment"
	}
	c.Header("Content-Type", contentType)
	c.Header("Content-Disposition", disposition)
	if resp.ContentLength >= 0 {
		c.Header("Content-Length", strconv.FormatInt(resp.ContentLength, 10))
	}
	c.Status(http.StatusOK)
	// Local files do not observe context cancellation while a slow client blocks
	// a socket write. Bound the attachment transfer as well as its preparation.
	controller := http.NewResponseController(c.Writer)
	if deadline, ok := downloadCtx.Deadline(); ok {
		_ = controller.SetWriteDeadline(deadline)
		defer controller.SetWriteDeadline(time.Time{})
	}
	written, copyErr := io.Copy(c.Writer, io.LimitReader(resp.Body, maxVideoDownloadBytes+1))
	if copyErr != nil || written == 0 || written > maxVideoDownloadBytes || (resp.ContentLength >= 0 && written != resp.ContentLength) {
		h.failActivity(activity, "下载连接提前结束")
		return
	}
	h.completeDownloadActivity(activity, written)
}
