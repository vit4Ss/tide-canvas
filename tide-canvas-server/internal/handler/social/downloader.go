package social

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime"
	"net/http"
	"net/url"
	"path"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/gin-gonic/gin"

	"tidecanvas/internal/middleware"
	"tidecanvas/internal/pkg/response"
	"tidecanvas/internal/pkg/safefetch"
	"tidecanvas/internal/pkg/token"
)

const (
	maxDownloaderJSONBody  = 1 << 20
	maxDownloaderInputBody = 16 << 10
	maxRelayVideoBytes     = int64(2 << 30)
	videoDownloadTicketMax = 5 * time.Minute
	videoDownloadMaxTime   = time.Hour
)

var relayDownloadTokenPattern = regexp.MustCompile(`^[A-Za-z0-9._~-]{1,512}$`)

type downloaderCapabilitiesVO struct {
	Enabled         bool     `json:"enabled"`
	Platforms       []string `json:"platforms"`
	MaxFileBytes    int64    `json:"maxFileBytes"`
	TokenTTLSeconds int      `json:"tokenTtlSeconds"`
}

type videoDownloadResolveDTO struct {
	URL     string `json:"url" binding:"required"`
	Quality string `json:"quality"`
}

type videoDownloadResolveVO struct {
	ID              string `json:"id"`
	Platform        string `json:"platform"`
	Title           string `json:"title"`
	DurationSeconds int    `json:"durationSeconds"`
	Width           int    `json:"width"`
	Height          int    `json:"height"`
	EstimatedBytes  int64  `json:"estimatedBytes"`
	Quality         string `json:"quality"`
	ExpiresAt       int64  `json:"expiresAt"`
	FileName        string `json:"fileName"`
	DownloadURL     string `json:"downloadUrl"`
}

type relayVideoDownloader struct {
	baseURL        string
	apiKey         string
	jsonClient     *http.Client
	downloadClient *http.Client
	cacheMu        sync.Mutex
	cached         downloaderCapabilitiesVO
	cacheUntil     time.Time
}

type relayDownloaderError struct {
	status  int
	code    string
	message string
}

func (e *relayDownloaderError) Error() string { return e.message }

func newRelayVideoDownloader(baseURL, apiKey string) *relayVideoDownloader {
	baseURL = strings.TrimRight(strings.TrimSpace(baseURL), "/")
	apiKey = strings.TrimSpace(apiKey)
	if baseURL == "" || apiKey == "" {
		return nil
	}
	jsonClient := &http.Client{
		Timeout: 60 * time.Second,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) >= 3 {
				return errors.New("too many relay redirects")
			}
			if len(via) > 0 && !sameOrigin(req.URL, via[0].URL) {
				return errors.New("cross-origin relay redirect is not allowed")
			}
			return nil
		},
	}
	downloadClient := &http.Client{
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) >= 5 {
				return errors.New("too many relay download redirects")
			}
			if err := safefetch.ValidateParsedURL(req.URL); err != nil {
				return err
			}
			if len(via) > 0 && !sameOrigin(req.URL, via[0].URL) {
				req.Header.Del("Authorization")
			}
			return nil
		},
	}
	return &relayVideoDownloader{baseURL: baseURL, apiKey: apiKey, jsonClient: jsonClient, downloadClient: downloadClient}
}

func sameOrigin(left, right *url.URL) bool {
	return left != nil && right != nil && strings.EqualFold(left.Scheme, right.Scheme) && strings.EqualFold(left.Host, right.Host)
}

func (d *relayVideoDownloader) request(ctx context.Context, method, endpoint string, body any, client *http.Client) (*http.Response, error) {
	if d == nil {
		return nil, &relayDownloaderError{status: http.StatusServiceUnavailable, code: "disabled", message: "视频下载服务尚未配置"}
	}
	base, err := url.Parse(d.baseURL)
	if err != nil || base.Hostname() == "" || base.User != nil || (base.Scheme != "http" && base.Scheme != "https") || base.RawQuery != "" || base.Fragment != "" {
		return nil, errors.New("invalid relay base URL")
	}
	var reader io.Reader
	if body != nil {
		encoded, marshalErr := json.Marshal(body)
		if marshalErr != nil {
			return nil, marshalErr
		}
		reader = bytes.NewReader(encoded)
	}
	req, err := http.NewRequestWithContext(ctx, method, d.baseURL+endpoint, reader)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+d.apiKey)
	if strings.Contains(endpoint, "/video-downloader/download/") {
		req.Header.Set("Accept", "video/*,application/octet-stream;q=0.9,*/*;q=0.1")
	} else {
		req.Header.Set("Accept", "application/json")
	}
	req.Header.Set("User-Agent", "FlowingLight-VideoDownloader/1.0")
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	return client.Do(req)
}

func decodeRelayDownloaderError(resp *http.Response) error {
	if resp == nil {
		return &relayDownloaderError{status: http.StatusBadGateway, code: "upstream_error", message: "视频下载服务暂时不可用"}
	}
	defer resp.Body.Close()
	payload := struct {
		Error string `json:"error"`
		Code  string `json:"code"`
	}{}
	_ = json.NewDecoder(io.LimitReader(resp.Body, 64<<10)).Decode(&payload)
	message := strings.TrimSpace(payload.Error)
	if message == "" {
		message = fmt.Sprintf("视频下载服务返回 HTTP %d", resp.StatusCode)
	}
	return &relayDownloaderError{status: resp.StatusCode, code: strings.TrimSpace(payload.Code), message: message}
}

func (d *relayVideoDownloader) platforms(ctx context.Context) (downloaderCapabilitiesVO, error) {
	if d == nil {
		return downloaderCapabilitiesVO{Platforms: []string{}}, nil
	}
	now := time.Now()
	d.cacheMu.Lock()
	if now.Before(d.cacheUntil) {
		cached := d.cached
		cached.Platforms = append([]string{}, cached.Platforms...)
		d.cacheMu.Unlock()
		return cached, nil
	}
	d.cacheMu.Unlock()
	resp, err := d.request(ctx, http.MethodGet, "/v1/tools/video-downloader/platforms", nil, d.jsonClient)
	if err != nil {
		return downloaderCapabilitiesVO{}, err
	}
	if resp.StatusCode != http.StatusOK {
		return downloaderCapabilitiesVO{}, decodeRelayDownloaderError(resp)
	}
	defer resp.Body.Close()
	var payload struct {
		Enabled         bool     `json:"enabled"`
		Platforms       []string `json:"platforms"`
		MaxFileBytes    int64    `json:"max_file_bytes"`
		TokenTTLSeconds int      `json:"token_ttl_seconds"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, maxDownloaderJSONBody)).Decode(&payload); err != nil {
		return downloaderCapabilitiesVO{}, errors.New("invalid relay downloader capabilities")
	}
	platforms := make([]string, 0, len(payload.Platforms))
	seen := map[string]bool{}
	for _, platform := range payload.Platforms {
		platform = strings.ToLower(strings.TrimSpace(platform))
		if platform == "" || len(platform) > 32 || seen[platform] {
			continue
		}
		seen[platform] = true
		platforms = append(platforms, platform)
	}
	capabilities := downloaderCapabilitiesVO{
		Enabled: payload.Enabled, Platforms: platforms,
		MaxFileBytes: payload.MaxFileBytes, TokenTTLSeconds: payload.TokenTTLSeconds,
	}
	if capabilities.MaxFileBytes <= 0 || capabilities.MaxFileBytes > maxRelayVideoBytes {
		capabilities.MaxFileBytes = 512 << 20
	}
	if capabilities.TokenTTLSeconds <= 0 || capabilities.TokenTTLSeconds > 3600 {
		capabilities.TokenTTLSeconds = 600
	}
	// The browser receives an application-issued ticket, not the Relay token.
	// Report the shorter effective lifetime so the UI does not over-promise.
	if localMax := int(videoDownloadTicketMax / time.Second); capabilities.TokenTTLSeconds > localMax {
		capabilities.TokenTTLSeconds = localMax
	}
	d.cacheMu.Lock()
	d.cached = capabilities
	d.cacheUntil = now.Add(time.Minute)
	d.cacheMu.Unlock()
	return capabilities, nil
}

func (d *relayVideoDownloader) resolve(ctx context.Context, sourceURL, quality string) (videoDownloadResolveVO, error) {
	resp, err := d.request(ctx, http.MethodPost, "/v1/tools/video-downloader/resolve", map[string]string{"url": sourceURL, "quality": quality}, d.jsonClient)
	if err != nil {
		return videoDownloadResolveVO{}, err
	}
	if resp.StatusCode != http.StatusOK {
		return videoDownloadResolveVO{}, decodeRelayDownloaderError(resp)
	}
	defer resp.Body.Close()
	var payload struct {
		ID              string `json:"id"`
		Platform        string `json:"platform"`
		Title           string `json:"title"`
		DurationSeconds int    `json:"duration_seconds"`
		Width           int    `json:"width"`
		Height          int    `json:"height"`
		EstimatedBytes  int64  `json:"estimated_bytes"`
		Quality         string `json:"quality"`
		ExpiresAt       int64  `json:"expires_at"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, maxDownloaderJSONBody)).Decode(&payload); err != nil {
		return videoDownloadResolveVO{}, errors.New("invalid relay downloader response")
	}
	payload.ID = strings.TrimSpace(payload.ID)
	if !relayDownloadTokenPattern.MatchString(payload.ID) {
		return videoDownloadResolveVO{}, errors.New("relay returned an invalid download token")
	}
	payload.Platform = strings.ToLower(strings.TrimSpace(payload.Platform))
	payload.Title = truncateText(payload.Title, 200)
	if payload.Platform == "" || len(payload.Platform) > 32 || payload.DurationSeconds < 0 || payload.DurationSeconds > 7*24*60*60 || payload.Width < 0 || payload.Width > 100000 || payload.Height < 0 || payload.Height > 100000 || payload.EstimatedBytes < 0 || payload.EstimatedBytes > maxRelayVideoBytes {
		return videoDownloadResolveVO{}, errors.New("relay returned invalid video metadata")
	}
	if payload.ExpiresAt <= time.Now().Unix() {
		return videoDownloadResolveVO{}, &relayDownloaderError{status: http.StatusBadRequest, code: "expired", message: "视频解析令牌已过期，请重新解析"}
	}
	resolvedQuality := strings.ToLower(strings.TrimSpace(payload.Quality))
	if resolvedQuality != "quality" && resolvedQuality != "compat" && resolvedQuality != "speed" {
		resolvedQuality = quality
	}
	return videoDownloadResolveVO{
		ID: payload.ID, Platform: payload.Platform, Title: payload.Title,
		DurationSeconds: payload.DurationSeconds, Width: payload.Width, Height: payload.Height,
		EstimatedBytes: payload.EstimatedBytes, Quality: resolvedQuality,
		ExpiresAt: payload.ExpiresAt,
	}, nil
}

func (d *relayVideoDownloader) download(ctx context.Context, id string) (*http.Response, error) {
	if !relayDownloadTokenPattern.MatchString(id) {
		return nil, &relayDownloaderError{status: http.StatusBadRequest, code: "bad_request", message: "下载令牌格式无效"}
	}
	return d.request(ctx, http.MethodGet, "/v1/tools/video-downloader/download/"+url.PathEscape(id), nil, d.downloadClient)
}

func (h *handler) downloaderPlatforms(c *gin.Context) {
	if h.downloader == nil {
		response.OK(c, downloaderCapabilitiesVO{Platforms: []string{}})
		return
	}
	capabilities, err := h.downloader.platforms(c.Request.Context())
	if err != nil {
		writeRelayDownloaderError(c, err)
		return
	}
	response.OK(c, capabilities)
}

func writeRelayDownloaderError(c *gin.Context, err error) {
	var upstream *relayDownloaderError
	if errors.As(err, &upstream) {
		switch upstream.status {
		case http.StatusBadRequest:
			message := safeMessage(upstream.message)
			if upstream.code == "bad_request" || strings.Contains(strings.ToLower(upstream.message), "not publicly accessible") {
				message = "视频无法公开访问：可能已删除、受地区限制、需要登录，或链接类型不受支持"
			}
			response.Fail(c, response.CodeBadRequest, message)
		case http.StatusNotFound:
			response.Fail(c, response.CodeNotFound, "下载令牌不存在或已过期，请重新解析")
		case http.StatusTooManyRequests:
			response.Fail(c, response.CodeRateLimited, "视频下载请求过于频繁，请稍后重试")
		default:
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
		response.Fail(c, response.CodeToolDisabled, "视频下载服务尚未配置，请联系管理员配置 Relay API Key")
		return
	}
	capabilities, err := h.downloader.platforms(c.Request.Context())
	if err != nil {
		writeRelayDownloaderError(c, err)
		return
	}
	if !capabilities.Enabled {
		response.Fail(c, response.CodeToolDisabled, "视频下载服务当前未启用")
		return
	}
	resolved, err := h.downloader.resolve(c.Request.Context(), sourceURL, quality)
	if err != nil {
		writeRelayDownloaderError(c, err)
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
	ticket, err := token.IssueDownloadTicket(middleware.CurrentUserID(c), middleware.CurrentRole(c), relayVideoTicketResource(resolved.ID), name, ttl)
	if err != nil {
		response.Fail(c, response.CodeServerError, "failed to issue video download ticket")
		return
	}
	query := url.Values{"ticket": {ticket}, "name": {name}}
	resolved.ExpiresAt = time.Now().Add(ttl).Unix()
	resolved.FileName = name
	resolved.DownloadURL = "/api/social-analysis/downloader/download/" + url.PathEscape(resolved.ID) + "?" + query.Encode()
	response.OK(c, resolved)
}

func relayVideoTicketResource(id string) string { return "relay-video-download:" + id }

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
		if !relayDownloadTokenPattern.MatchString(id) || len(ticket) == 0 || len(ticket) > 4096 || utf8.RuneCountInString(name) > 140 {
			response.Fail(c, response.CodeUnauthorized, "下载地址无效或已过期，请重新解析")
			c.Abort()
			return
		}
		claims, err := token.ParseDownloadTicket(ticket, relayVideoTicketResource(id), name)
		if err != nil {
			response.Fail(c, response.CodeUnauthorized, "下载地址无效或已过期，请重新解析")
			c.Abort()
			return
		}
		c.Set(middleware.CtxUserID, claims.UserID)
		c.Set(middleware.CtxRole, claims.Role)
		c.Set(middleware.CtxJTI, claims.ID)
		c.Header("Cache-Control", "private, no-store")
		c.Header("Referrer-Policy", "no-referrer")
		c.Next()
	}
}

func (h *handler) downloadVideo(c *gin.Context) {
	id := strings.TrimSpace(c.Param("token"))
	name := downloadVideoFileName(c.Query("name"))
	if h.downloader == nil {
		response.Fail(c, response.CodeToolDisabled, "视频下载服务尚未配置")
		return
	}
	downloadCtx, cancel := context.WithTimeout(c.Request.Context(), videoDownloadMaxTime)
	defer cancel()
	resp, err := h.downloader.download(downloadCtx, id)
	if err != nil {
		writeRelayDownloaderError(c, err)
		return
	}
	if resp.StatusCode != http.StatusOK {
		writeRelayDownloaderError(c, decodeRelayDownloaderError(resp))
		return
	}
	defer resp.Body.Close()
	if resp.ContentLength > maxRelayVideoBytes {
		response.Fail(c, response.CodeBadRequest, "视频文件超过本站下载上限")
		return
	}
	contentType := strings.TrimSpace(resp.Header.Get("Content-Type"))
	mediaType := strings.ToLower(strings.TrimSpace(strings.SplitN(contentType, ";", 2)[0]))
	if mediaType == "application/json" || strings.HasSuffix(mediaType, "+json") || strings.HasPrefix(mediaType, "text/") {
		writeRelayDownloaderError(c, decodeRelayDownloaderError(resp))
		return
	}
	if resp.ContentLength == 0 {
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
	_, _ = io.Copy(c.Writer, io.LimitReader(resp.Body, maxRelayVideoBytes+1))
}
