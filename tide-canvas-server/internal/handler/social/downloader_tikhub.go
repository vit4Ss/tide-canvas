package social

import (
	"context"
	"errors"
	"net/http"
	"net/url"
	"time"

	"go.uber.org/zap"

	"tidecanvas/internal/pkg/logger"
	"tidecanvas/internal/pkg/videodownload"
)

func (h *handler) resolveDouyinDownload(ctx context.Context, source, quality string) (*videodownload.ResolvedVideo, error) {
	if ctx.Err() != nil {
		return nil, &videodownload.Error{Status: 504, Message: "抖音视频解析已取消或超时"}
	}
	cfg, err := h.loadSettingsContext(ctx)
	if err != nil {
		if ctx.Err() != nil {
			return nil, &videodownload.Error{Status: 504, Message: "抖音视频解析已取消或超时"}
		}
		return nil, &videodownload.Error{Status: 503, Message: "暂时无法读取视频解析配置，请稍后重试"}
	}
	if !cfg.enabled || cfg.apiKey == "" {
		return nil, nil // No provider configured: retain the local yt-dlp fallback.
	}
	return h.fetchDouyinDownload(ctx, cfg, source, quality)
}

func (h *handler) fetchDouyinDownload(ctx context.Context, cfg settings, source, quality string) (result *videodownload.ResolvedVideo, resultErr error) {
	u, err := url.Parse(source)
	if err != nil {
		return nil, &videodownload.Error{Status: 400, Message: "无效的抖音作品链接"}
	}
	query := url.Values{"region": {"CN"}}
	if id := douyinWorkID(u); id != "" {
		query.Set("aweme_id", id)
	} else {
		query.Set("share_url", source)
	}
	id := douyinWorkID(u)
	path, params := "fetch_one_video_by_share_url", url.Values{"share_url": {source}}
	if id != "" {
		path, params = "fetch_one_video", url.Values{"aweme_id": {id}}
	}
	type downloadCall struct {
		upstreamCall
		original bool
	}
	originalCalls := []downloadCall{
		{upstreamCall{"/api/v1/douyin/web/fetch_video_high_quality_play_url", query}, true},
		{upstreamCall{"/api/v1/douyin/app/v3/fetch_video_high_quality_play_url", query}, true},
	}
	detailCalls := []downloadCall{
		{upstreamCall{"/api/v1/douyin/app/v3/" + path, params}, false},
		{upstreamCall{"/api/v1/douyin/web/" + path, params}, false},
	}
	if id != "" {
		// V1 and V2 can fail independently. The official docs recommend the
		// alternate version; prefer V2 but retain the legacy endpoints.
		detailCalls = append([]downloadCall{
			{upstreamCall{"/api/v1/douyin/app/v3/fetch_one_video_v2", params}, false},
			{upstreamCall{"/api/v1/douyin/web/fetch_one_video_v2", params}, false},
		}, detailCalls...)
	}
	// For compat/speed prefer the platform's appropriately sized renditions.
	// Fetching the original first can exceed the file cap before local scaling.
	calls := append(detailCalls, originalCalls...)
	if quality == "quality" {
		calls = append(originalCalls, detailCalls...)
	}
	startedAt := time.Now()
	attempts, lastEndpoint := 0, ""
	defer func() {
		fields := []zap.Field{zap.String("aweme_id", id), zap.String("quality", quality), zap.Int("attempts", attempts), zap.String("endpoint", lastEndpoint), zap.Duration("elapsed", time.Since(startedAt))}
		if resultErr != nil {
			fields = append(fields, zap.String("outcome", "failed"), zap.String("message", tikHubSafeDiagnostic(resultErr.Error(), cfg.apiKey)))
			logger.L().Warn("douyin download resolver completed", fields...)
		} else {
			fields = append(fields, zap.String("outcome", "resolved"))
			logger.L().Info("douyin download resolver completed", fields...)
		}
	}()
	var lastErr error
	var alternate *downloadCall
	v3Attempted := false
	for i := 0; i < len(calls) || alternate != nil; {
		if ctx.Err() != nil {
			break
		}
		var call downloadCall
		if alternate != nil {
			call, alternate = *alternate, nil
		} else {
			call = calls[i]
			i++
		}
		attempts++
		lastEndpoint = call.path
		timeout := 10 * time.Second
		if call.original {
			timeout = 15 * time.Second
		}
		callCtx, cancel := context.WithTimeout(ctx, timeout)
		started := time.Now()
		data, err := h.tikhubGet(callCtx, cfg, call.path, call.query)
		cancel()
		filterReason := ""
		if err == nil {
			item := douyinWorkObject(data, id)
			if call.original {
				item, _ = data.(map[string]any)
			}
			if item != nil {
				var video *videodownload.ResolvedVideo
				video, err = videodownload.DouyinProviderVideo(item, source, quality)
				if video != nil && err == nil {
					return video, nil
				}
			} else if rows, ok := directValue(douyinData(data), "filter_list").([]any); ok {
				for _, row := range rows {
					if actual := directString(row, "aweme_id"); actual != "" && id != "" && actual != id {
						continue
					}
					switch directString(row, "reason") {
					case "5", "10":
						return nil, &videodownload.Error{Status: 400, Message: "该抖音作品不是公开内容，暂不支持下载"}
					case "8":
						filterReason = "8"
						err = &videodownload.Error{Status: 502, Message: "抖音详情接口未返回该作品（reason=8），暂未获取到可下载视频"}
						// TikHub documents V3 specifically for V1/V2 reason=8.
						// Try it once immediately; a failure still falls through to
						// the existing Web/detail/original endpoints.
						if id != "" && !v3Attempted {
							v3Attempted = true
							alternate = &downloadCall{upstreamCall{"/api/v1/douyin/app/v3/fetch_one_video_v3", url.Values{"aweme_id": {id}}}, false}
						}
					}
				}
			}
		}
		fatal := douyinDownloadFatal(err)
		nextEndpoint := ""
		if ctx.Err() == nil && fatal == nil {
			if alternate != nil {
				nextEndpoint = alternate.path
			} else if i < len(calls) {
				nextEndpoint = calls[i].path
			}
		}
		logDouyinDownloadAttempt(call.path, id, time.Since(started), err, attempts, filterReason, nextEndpoint)
		if fatal != nil {
			return nil, fatal
		}
		if err != nil {
			lastErr = err
		}
	}
	if ctx.Err() != nil {
		return nil, &videodownload.Error{Status: 504, Message: "抖音视频解析超时，请稍后重试"}
	}
	if errors.Is(lastErr, context.DeadlineExceeded) {
		return nil, &videodownload.Error{Status: 504, Message: "抖音视频解析接口响应超时，请稍后重试"}
	}
	message := "TikHub 暂未返回可下载的视频地址，请确认是公开视频后重试"
	if lastErr != nil {
		message = "抖音视频解析失败：" + safeMessage(lastErr.Error())
	}
	var upstream *upstreamError
	if errors.As(lastErr, &upstream) && (upstream.message == "HTTP 400" || upstream.message == "HTTP 422") {
		message = "TikHub 视频解析接口未接受请求，备用接口也未返回视频；请稍后重试或联系管理员查看解析日志"
	}
	return nil, &videodownload.Error{Status: 502, Message: message}
}

func logDouyinDownloadAttempt(path, id string, elapsed time.Duration, err error, attempt int, filterReason, nextEndpoint string) {
	message := "接口未返回可下载的视频地址"
	if err != nil {
		message = safeMessage(err.Error())
	}
	fields := []zap.Field{zap.String("endpoint", path), zap.String("aweme_id", id), zap.Int("attempt", attempt), zap.Duration("elapsed", elapsed), zap.String("message", message), zap.String("filter_reason", filterReason), zap.String("next_endpoint", nextEndpoint)}
	var upstream *upstreamError
	if errors.As(err, &upstream) {
		fields = append(fields, zap.Int("http_status", upstream.httpStatus), zap.Int("code", upstream.status), zap.String("provider_request_id", upstream.requestID))
	}
	// An expected fallback is not a terminal failure. The final summary above
	// records whether an endpoint actually resolved media or all attempts failed.
	logger.L().Info("douyin download resolver attempt failed", fields...)
}

func douyinDownloadFatal(err error) error {
	var problem *videodownload.Error
	if errors.As(err, &problem) && problem.Status == 400 {
		return err
	}
	var upstream *upstreamError
	if errors.As(err, &upstream) {
		switch upstream.status {
		case http.StatusUnauthorized, http.StatusForbidden, http.StatusPaymentRequired, http.StatusTooManyRequests:
			return &videodownload.Error{Status: 503, Message: safeMessage(upstream.message)}
		}
	}
	return nil
}
