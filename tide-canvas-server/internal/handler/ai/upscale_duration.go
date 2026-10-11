package ai

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"os/exec"
	"strconv"
	"strings"
	"time"

	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/idgen"
)

var errVideoProbeUnavailable = errors.New("video duration probe is unavailable")

const (
	videoProbeTimeout       = 45 * time.Second
	maxConcurrentVideoProbe = 8
	videoProbeStdoutLimit   = 4 << 10
	videoProbeStderrLimit   = 64 << 10
)

// ffprobe starts an operating-system process and may hold a network connection
// for tens of seconds. Keep one process-wide ceiling shared by quote, generate,
// reference-video and upscale paths; the reference-video path also applies its
// tighter per-request ceiling before reaching this gate.
var videoProbeSlots = make(chan struct{}, maxConcurrentVideoProbe)

// cappedProbeBuffer reports full writes to os/exec while retaining only a
// bounded prefix. A malformed media file can otherwise make ffprobe emit an
// unbounded amount of diagnostics before the timeout terminates the process.
type cappedProbeBuffer struct {
	bytes.Buffer
	limit int
}

func (b *cappedProbeBuffer) Write(p []byte) (int, error) {
	written := len(p)
	remaining := b.limit - b.Len()
	if remaining <= 0 {
		return written, nil
	}
	if len(p) > remaining {
		p = p[:remaining]
	}
	_, _ = b.Buffer.Write(p)
	return written, nil
}

type videoDurationConfirmer func(context.Context, idgen.ID, string) (canonicalURL string, durationSeconds float64, err error)

// prepareUpscalePricingInput replaces all client duration claims with media
// metadata confirmed by this server. The normalized input is subsequently used
// by the charge, task receipt and provider call, so all three stay auditable.
func (s *service) prepareUpscalePricingInput(ctx context.Context, userID idgen.ID, dto *generateDTO, m *model.AiModel) error {
	if m == nil || m.Type != "upscale" {
		return nil
	}
	var input map[string]any
	if len(dto.Input) == 0 || json.Unmarshal(dto.Input, &input) != nil || input == nil {
		return skillPlacementError{message: "视频超分参数无效，请重新选择视频"}
	}
	if extras := input["extras"]; extras != nil {
		if _, ok := extras.(map[string]any); !ok {
			return skillPlacementError{message: "视频超分 extras 参数必须是对象"}
		}
	}
	options, err := (&relayProviderClient{}).upscaleParams(m.ModelID, input).NormalizedOptions()
	if err != nil {
		message := "所选增强档位不受支持，请调整后重试"
		if strings.Contains(err.Error(), "output_fps") {
			message = "所选输出帧率或插帧倍率不受支持，请调整后重试"
		}
		return skillPlacementError{message: message}
	}
	// Pin the default sent upstream. A relay route default must not execute a
	// different enhancement tier from the max tier quoted and charged here.
	if strings.EqualFold(strings.TrimSpace(m.ModelID), "rh-upscale") && inputStr(options, "upscale_model") == "" {
		options["upscale_model"] = "max"
	}
	resolution := strings.ToLower(inputStr(input, "targetResolution", "target_resolution"))
	switch resolution {
	case "720p", "1080p", "2k", "4k", "":
	default:
		return skillPlacementError{message: "所选目标分辨率不受支持，请调整后重试"}
	}
	if resolution == "720p" && strings.EqualFold(strings.TrimSpace(m.ModelID), "bytedance/video-upscaler") {
		return skillPlacementError{message: "所选模型不支持 720p，请选择更高的目标分辨率"}
	}
	if resolution == "" || resolveUpscalePointRate(m, resolution, inputStr(options, "upscale_model")) <= 0 {
		return skillPlacementError{message: "所选规格尚未配置每秒积分，请更换模型、增强档位或输出规格"}
	}
	sourceURL := inputStr(input, "videoUrl", "video_url", "video", "sourceVideo")
	if sourceURL == "" {
		return skillPlacementError{message: "请选择需要超分的视频"}
	}
	if s.confirmVideoDuration == nil {
		return errVideoProbeUnavailable
	}
	canonical, duration, err := s.confirmVideoDuration(ctx, userID, sourceURL)
	if err != nil {
		if errors.Is(err, errVideoProbeUnavailable) {
			return err
		}
		return skillPlacementError{message: "服务端无法确认源视频时长，请重新选择已上传的视频"}
	}
	if duration <= 0 || math.IsNaN(duration) || math.IsInf(duration, 0) {
		return skillPlacementError{message: "服务端无法确认源视频时长，请重新选择视频"}
	}

	// Millisecond precision is sufficient for billing and avoids persisting
	// unstable float tails from different ffprobe builds. Round upward so media
	// metadata just beyond a billing boundary is never under-counted.
	duration = math.Ceil(duration*1000) / 1000
	input["videoUrl"] = canonical
	input["targetResolution"] = resolution
	input["duration"] = duration
	input["billedSeconds"] = model.UpscaleBilledSeconds(m.Config, duration)
	delete(input, "video_url")
	delete(input, "sourceVideo")
	delete(input, "target_resolution")
	delete(input, "output_fps")
	delete(input, "upscale_model")
	for _, field := range []struct{ upstream, input string }{
		{"output_fps", "outputFps"}, {"upscale_model", "upscaleModel"},
	} {
		if value, ok := options[field.upstream]; ok {
			input[field.input] = value
		} else {
			delete(input, field.input)
		}
	}
	if extras, ok := input["extras"].(map[string]any); ok {
		delete(extras, "output_fps")
		delete(extras, "upscale_model")
		if len(extras) == 0 {
			delete(input, "extras")
		}
	}
	encoded, err := json.Marshal(input)
	if err != nil {
		return err
	}
	if _, configured, valid := resolveUpscaleTimeCost(m, encoded); !configured || !valid {
		return skillPlacementError{message: "视频超分积分配置无效或总积分超出系统范围，请联系管理员"}
	}
	dto.Input = encoded
	return nil
}

func (s *service) quoteUpscale(ctx context.Context, userID idgen.ID, quote upscaleQuoteDTO) (*upscaleQuoteVO, error) {
	m, err := s.repo.findModel(ctx, strings.TrimSpace(quote.ModelID))
	if err != nil {
		return nil, err
	}
	if m == nil || !m.Enabled || m.Type != "upscale" {
		return nil, errNoModel
	}
	if err := validateModelAvailability(m); err != nil {
		return nil, err
	}
	input, err := json.Marshal(map[string]any{
		"videoUrl":         strings.TrimSpace(quote.VideoURL),
		"targetResolution": strings.ToLower(strings.TrimSpace(quote.TargetResolution)),
		"upscaleModel":     quote.UpscaleModel,
	})
	if err != nil {
		return nil, err
	}
	generate := generateDTO{Handler: "video_upscale", ModelID: quote.ModelID, Input: input}
	if err := s.prepareUpscalePricingInput(ctx, userID, &generate, m); err != nil {
		return nil, err
	}
	var confirmed map[string]any
	if err := json.Unmarshal(generate.Input, &confirmed); err != nil {
		return nil, err
	}
	resolution := inputStr(confirmed, "targetResolution")
	duration := durationSeconds(confirmed["duration"])
	level := inputStr(confirmed, "upscaleModel")
	rate := resolveUpscalePointRate(m, resolution, level)
	return &upscaleQuoteVO{
		DurationSeconds: duration,
		BilledSeconds:   model.UpscaleBilledSeconds(m.Config, duration),
		RatePerSecond:   rate,
		PointCost:       resolveCost(m, generate.Input),
		Resolution:      resolution,
		UpscaleModel:    level,
	}, nil
}

// confirmOwnedVideoDuration accepts only media already registered to the
// caller in this storage namespace. This prevents ffprobe from becoming an
// authenticated SSRF primitive while still supporting uploads and generated
// videos selected from the asset library.
func (s *service) confirmOwnedVideoDuration(ctx context.Context, userID idgen.ID, rawURL string) (string, float64, error) {
	if s == nil || s.repo == nil || s.repo.db == nil || s.storage == nil {
		return "", 0, errors.New("video ownership verifier unavailable")
	}
	rawURL = strings.TrimSpace(rawURL)
	canonical, ownedByStorage := s.storage.OwnsURL(rawURL)
	if !ownedByStorage || strings.TrimSpace(canonical) == "" {
		return "", 0, errors.New("video is outside managed storage")
	}
	// Prefer the storage backend's regional/acceleration URL for server-side
	// probing. A CDN-only display host may be optimized for browsers or blocked
	// from the origin network; UpstreamURL already encodes that storage policy.
	probeURL := s.storage.UpstreamURL(canonical)

	candidates := []string{rawURL, canonical}
	for _, pair := range s.storage.PublicRewrites() {
		if pair[0] != "" && pair[1] != "" && strings.HasPrefix(rawURL, pair[1]) {
			candidates = append(candidates, pair[0]+strings.TrimPrefix(rawURL, pair[1]))
		}
	}
	candidates = uniqueNonEmptyStrings(candidates)

	var count int64
	if err := s.repo.db.WithContext(ctx).Model(&model.File{}).
		Where("owner_id = ? AND file_type = ? AND file_url IN ?", userID, "video", candidates).
		Count(&count).Error; err != nil {
		return "", 0, err
	}
	if count == 0 {
		if err := s.repo.db.WithContext(ctx).Model(&model.AiTask{}).
			Where("user_id = ? AND status = ? AND result_url IN ?", userID, statusSuccess, candidates).
			Count(&count).Error; err != nil {
			return "", 0, err
		}
	}
	if count == 0 {
		return "", 0, errors.New("video does not belong to caller")
	}

	duration, err := probeVideoDuration(ctx, probeURL)
	if err != nil {
		return "", 0, err
	}
	return canonical, duration, nil
}

func uniqueNonEmptyStrings(values []string) []string {
	seen := make(map[string]struct{}, len(values))
	out := make([]string, 0, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" {
			continue
		}
		if _, ok := seen[value]; ok {
			continue
		}
		seen[value] = struct{}{}
		out = append(out, value)
	}
	return out
}

// probeVideoDuration reads container metadata only. Arguments are passed
// directly to exec.CommandContext (never through a shell); the protocol list
// excludes local files and playlist-specific schemes.
func probeVideoDuration(ctx context.Context, sourceURL string) (float64, error) {
	binary, err := exec.LookPath("ffprobe")
	if err != nil {
		return 0, fmt.Errorf("%w: %v", errVideoProbeUnavailable, err)
	}
	probeCtx, cancel := context.WithTimeout(ctx, videoProbeTimeout)
	defer cancel()
	select {
	case videoProbeSlots <- struct{}{}:
		defer func() { <-videoProbeSlots }()
	case <-probeCtx.Done():
		return 0, fmt.Errorf("ffprobe queue timeout: %w", probeCtx.Err())
	}
	cmd := exec.CommandContext(probeCtx, binary,
		"-v", "error",
		"-protocol_whitelist", "http,https,tcp,tls",
		"-rw_timeout", "30000000",
		"-select_streams", "v",
		"-show_entries", "format=duration:stream=duration",
		"-of", "json",
		strings.TrimSpace(sourceURL),
	)
	stdout := cappedProbeBuffer{limit: videoProbeStdoutLimit}
	stderr := cappedProbeBuffer{limit: videoProbeStderrLimit}
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		if probeCtx.Err() != nil {
			return 0, fmt.Errorf("ffprobe timeout: %w", probeCtx.Err())
		}
		return 0, fmt.Errorf("ffprobe failed: %w (%s)", err, strings.TrimSpace(stderr.String()))
	}
	duration, err := confirmedProbeDuration(stdout.Bytes())
	if err != nil {
		return 0, errors.New("ffprobe returned an invalid duration")
	}
	return duration, nil
}

// confirmedProbeDuration uses the longest trustworthy duration reported for
// the container or any video stream. Container-only duration can understate a
// malformed or unusually muxed stream; charging the maximum fails closed while
// still accepting ordinary files whose individual stream duration is absent.
func confirmedProbeDuration(raw []byte) (float64, error) {
	var payload struct {
		Streams []struct {
			Duration string `json:"duration"`
		} `json:"streams"`
		Format struct {
			Duration string `json:"duration"`
		} `json:"format"`
	}
	if json.Unmarshal(raw, &payload) != nil || len(payload.Streams) == 0 {
		return 0, errors.New("no video stream duration")
	}
	longest := validProbeDuration(payload.Format.Duration)
	for _, stream := range payload.Streams {
		longest = math.Max(longest, validProbeDuration(stream.Duration))
	}
	if longest <= 0 || math.IsNaN(longest) || math.IsInf(longest, 0) {
		return 0, errors.New("invalid video duration")
	}
	return longest, nil
}

func validProbeDuration(raw string) float64 {
	duration, err := strconv.ParseFloat(strings.TrimSpace(raw), 64)
	if err != nil || duration <= 0 || math.IsNaN(duration) || math.IsInf(duration, 0) {
		return 0
	}
	return duration
}
