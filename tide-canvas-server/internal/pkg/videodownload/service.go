package videodownload

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"tidecanvas/internal/config"
	"tidecanvas/internal/pkg/safefetch"
)

const userAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"

type Error struct {
	Status  int
	Message string
}

func (e *Error) Error() string                 { return e.Message }
func failure(status int, message string) error { return &Error{status, message} }

type Metadata struct {
	Platform, SourceURL, Title, CoverURL string
	DurationSeconds, Width, Height       int
	EstimatedBytes                       int64
}
type mediaPart struct {
	URLs []string
	Size int64
}
type downloadPlan struct {
	Metadata
	Parts []mediaPart
	Audio *mediaPart
}
type File struct {
	*os.File
	Size    int64
	cleanup func()
	once    sync.Once
}

func (f *File) Close() error {
	var err error
	f.once.Do(func() { err = f.File.Close(); f.cleanup() })
	return err
}

type Service struct {
	cfg                 config.VideoDownloaderConfig
	client              *http.Client
	run                 commandRunner
	resolves, downloads chan struct{}
}

func New(cfg config.VideoDownloaderConfig) *Service {
	if cfg.Command == "" {
		cfg.Command = "yt-dlp"
	}
	if cfg.FFmpegCommand == "" {
		cfg.FFmpegCommand = "ffmpeg"
	}
	if cfg.FFprobeCommand == "" {
		cfg.FFprobeCommand = "ffprobe"
	}
	if cfg.JSRuntime == "" {
		cfg.JSRuntime = "node"
	}
	for _, binary := range []*string{&cfg.Command, &cfg.FFmpegCommand, &cfg.FFprobeCommand, &cfg.JSRuntime} {
		if resolved, err := exec.LookPath(*binary); err == nil {
			*binary = resolved
		}
	}
	if cfg.MaxFileBytes <= 0 || cfg.MaxFileBytes > 2<<30 {
		cfg.MaxFileBytes = 512 << 20
	}
	if cfg.MaxConcurrent <= 0 || cfg.MaxConcurrent > 16 {
		cfg.MaxConcurrent = 2
	}
	if cfg.MaxConcurrentResolves <= 0 || cfg.MaxConcurrentResolves > 32 {
		cfg.MaxConcurrentResolves = 4
	}
	if cfg.ResolveTimeout <= 0 || cfg.ResolveTimeout > 3*time.Minute {
		cfg.ResolveTimeout = time.Minute
	}
	if cfg.DownloadTimeout <= 0 || cfg.DownloadTimeout > time.Hour {
		cfg.DownloadTimeout = 15 * time.Minute
	}
	return &Service{cfg: cfg, client: safefetch.NewClient(cfg.DownloadTimeout, nil), run: runCommand, resolves: make(chan struct{}, cfg.MaxConcurrentResolves), downloads: make(chan struct{}, cfg.MaxConcurrent)}
}
func (s *Service) MaxBytes() int64 { return s.cfg.MaxFileBytes }
func (s *Service) Ready() bool {
	if s == nil || !s.cfg.Enabled {
		return false
	}
	for _, binary := range []string{s.cfg.Command, s.cfg.FFmpegCommand, s.cfg.FFprobeCommand, s.cfg.JSRuntime} {
		if _, err := exec.LookPath(binary); err != nil {
			return false
		}
	}
	return true
}
func (s *Service) check() error {
	if s == nil || !s.cfg.Enabled {
		return failure(503, "视频下载服务当前未启用")
	}
	if !s.Ready() {
		return failure(503, "视频下载组件尚未就绪，请联系管理员检查下载服务")
	}
	return nil
}
func qualityOK(q string) bool { return q == "compat" || q == "quality" || q == "speed" }
func (s *Service) Resolve(ctx context.Context, raw, quality string) (Metadata, error) {
	if err := s.check(); err != nil {
		return Metadata{}, err
	}
	if !qualityOK(quality) {
		return Metadata{}, failure(400, "请选择有效的下载画质")
	}
	source, platform, err := ValidateSource(raw)
	if err != nil {
		return Metadata{}, err
	}
	select {
	case s.resolves <- struct{}{}:
		defer func() { <-s.resolves }()
	default:
		return Metadata{}, failure(429, "视频解析任务较多，请稍后重试")
	}
	ctx, cancel := context.WithTimeout(ctx, s.cfg.ResolveTimeout)
	defer cancel()
	plan, err := s.resolvePlan(ctx, source, platform, quality)
	if err != nil {
		return Metadata{}, err
	}
	if plan.EstimatedBytes > s.cfg.MaxFileBytes {
		return Metadata{}, failure(400, "视频预计大小超过当前单文件下载上限，请选择更低画质")
	}
	return outputMetadata(plan.Metadata, quality), nil
}
func outputMetadata(m Metadata, quality string) Metadata {
	limit := 0
	if quality == "compat" {
		limit = 1080
	}
	if quality == "speed" {
		limit = 480
	}
	if limit > 0 && m.Height > limit {
		m.Width = int(math.Round(float64(m.Width)*float64(limit)/float64(m.Height)/2) * 2)
		m.Height = limit
	}
	return m
}
func (s *Service) resolvePlan(ctx context.Context, source, platform, quality string) (downloadPlan, error) {
	// Leave time for the general extractor if a public page/API is unavailable.
	directCtx, cancel := context.WithTimeout(ctx, min(s.cfg.ResolveTimeout/2, 25*time.Second))
	defer cancel()
	var plan *downloadPlan
	var err error
	switch platform {
	case "bilibili":
		plan, err = s.bilibili(directCtx, source, quality)
	case "douyin":
		plan, err = s.douyin(directCtx, source, quality)
	case "kuaishou", "pinterest":
		plan, err = s.sharePage(directCtx, source, platform, quality)
	}
	if err == nil && plan != nil {
		return *plan, nil
	}
	var publicErr *Error
	if errors.As(err, &publicErr) && publicErr.Status == 400 {
		return downloadPlan{}, err
	}
	if ctx.Err() != nil {
		return downloadPlan{}, failure(504, "视频解析超时，请稍后重试")
	}
	return s.extract(ctx, source, platform, quality)
}
func (s *Service) baseArgs(proxy string) []string {
	return []string{"--ignore-config", "--no-plugin-dirs", "--no-cache-dir", "--no-playlist", "--no-warnings", "--no-progress", "--socket-timeout", "15", "--retries", "1", "--extractor-retries", "1", "--use-extractors", "youtube.*,bilibili.*,tiktok.*,douyin.*,instagram.*,pinterest.*,kuaishou.*,kwai.*", "--js-runtimes", "node:" + s.cfg.JSRuntime, "--user-agent", userAgent, "--proxy", proxy, "--ffmpeg-location", s.cfg.FFmpegCommand}
}
func (s *Service) extract(ctx context.Context, source, platform, quality string) (downloadPlan, error) {
	proxy, closeProxy, err := publicProxy(ctx)
	if err != nil {
		return downloadPlan{}, failure(503, "视频解析组件暂时不可用")
	}
	defer closeProxy()
	args := append(s.baseArgs(proxy), "--dump-single-json", "--skip-download", "--format", formatSelector(quality), "--", source)
	stdout, stderr, err := s.run(ctx, s.cfg.Command, args, "", 0)
	if err != nil {
		return downloadPlan{}, commandError(ctx, stderr, err)
	}
	var data map[string]any
	decoder := json.NewDecoder(strings.NewReader(string(stdout)))
	decoder.UseNumber()
	if err := decoder.Decode(&data); err != nil || data == nil {
		return downloadPlan{}, failure(502, "视频平台返回了无法识别的解析结果")
	}
	if str(data, "_type") == "playlist" || len(array(data, "entries")) > 0 {
		return downloadPlan{}, failure(400, "暂不支持播放列表，请粘贴单个视频链接")
	}
	if flag(data, "is_live") || flag(data, "has_drm") || str(data, "live_status") == "is_upcoming" {
		return downloadPlan{}, failure(400, "暂不支持正在直播、尚未开播或受保护的视频")
	}
	if flag(data, "is_preview") {
		return downloadPlan{}, failure(400, "该视频仅提供试看，暂不支持完整下载")
	}
	switch str(data, "availability") {
	case "private", "premium_only", "subscriber_only", "needs_auth":
		return downloadPlan{}, failure(400, "该视频需要登录、订阅或付费，无法公开下载")
	}
	for _, key := range []string{"requested_formats", "formats"} {
		for _, v := range array(data, key) {
			if flag(object(v), "has_drm") {
				if key == "requested_formats" {
					return downloadPlan{}, failure(400, "暂不支持受保护的视频")
				}
			}
		}
	}
	m := Metadata{Platform: platform, SourceURL: source, Title: str(data, "title"), CoverURL: str(data, "thumbnail"), DurationSeconds: int(number(data, "duration")), Width: int(number(data, "width")), Height: int(number(data, "height")), EstimatedBytes: int64(firstNumber(data, "filesize", "filesize_approx"))}
	for _, v := range array(data, "requested_formats") {
		f := object(v)
		m.Width = max(m.Width, int(number(f, "width")))
		m.Height = max(m.Height, int(number(f, "height")))
	}
	if m.EstimatedBytes <= 0 {
		for _, v := range array(data, "requested_formats") {
			m.EstimatedBytes += int64(firstNumber(object(v), "filesize", "filesize_approx"))
		}
	}
	if m.DurationSeconds > 7*24*3600 || m.Width > 100000 || m.Height > 100000 {
		return downloadPlan{}, failure(400, "该视频的时长或尺寸超出支持范围")
	}
	if m.Title == "" {
		m.Title = "公开视频"
	}
	return downloadPlan{Metadata: m}, nil
}
func commandError(ctx context.Context, stderr []byte, err error) error {
	var e *Error
	if errors.As(err, &e) {
		return err
	}
	if ctx.Err() != nil {
		return failure(504, "视频处理超时或已取消，请稍后重试")
	}
	raw := redactCommandError(stderr)
	if strings.Contains(raw, "fragment") {
		return failure(502, "部分视频片段下载失败，请稍后重试")
	}
	for _, word := range []string{"private", "login", "sign in", "cookies", "forbidden", "403", "unavailable", "not available"} {
		if strings.Contains(raw, word) {
			return failure(400, "视频无法公开访问：可能已删除、受地区限制或需要登录")
		}
	}
	if strings.Contains(raw, "429") {
		return failure(429, "视频平台请求频繁，请稍后重试")
	}
	if strings.Contains(raw, "max-filesize") {
		return failure(400, "视频超过下载大小上限，请选择更低画质")
	}
	if strings.Contains(raw, "format") || strings.Contains(raw, "unsupported url") {
		return failure(400, "该链接或画质暂时不可用，请更换画质或视频链接")
	}
	return failure(502, "视频平台暂时无法完成处理，请稍后重试")
}

func (s *Service) Download(ctx context.Context, raw, quality string) (*File, error) {
	if err := s.check(); err != nil {
		return nil, err
	}
	if !qualityOK(quality) {
		return nil, failure(400, "无效的下载画质，请重新解析")
	}
	source, platform, err := ValidateSource(raw)
	if err != nil {
		return nil, err
	}
	select {
	case s.downloads <- struct{}{}:
	default:
		return nil, failure(429, "当前下载任务较多，请稍后重试")
	}
	release := func() { <-s.downloads }
	owned := true
	defer func() {
		if owned {
			release()
		}
	}()
	ctx, cancel := context.WithTimeout(ctx, s.cfg.DownloadTimeout)
	defer cancel()
	if s.cfg.TempDir != "" {
		if err = os.MkdirAll(s.cfg.TempDir, 0700); err != nil {
			return nil, failure(503, "视频临时存储不可用，请联系管理员")
		}
	}
	dir, err := os.MkdirTemp(s.cfg.TempDir, "flow-video-")
	if err != nil {
		return nil, failure(503, "视频临时存储不可用，请联系管理员")
	}
	dir, err = filepath.Abs(dir)
	if err != nil {
		return nil, err
	}
	keep := false
	defer func() {
		if !keep {
			_ = os.RemoveAll(dir)
		}
	}()
	// Refresh expiring platform URLs at download time; signed client metadata
	// carries only the public source and quality, so restart/load balancing is safe.
	resolveCtx, resolveCancel := context.WithTimeout(ctx, s.cfg.ResolveTimeout)
	plan, err := s.resolvePlan(resolveCtx, source, platform, quality)
	resolveCancel()
	if err != nil {
		return nil, err
	}
	if plan.EstimatedBytes > s.cfg.MaxFileBytes {
		return nil, failure(400, "视频超过当前单文件下载上限")
	}
	target := filepath.Join(dir, "result.mp4")
	if len(plan.Parts) > 0 {
		err = s.downloadDirect(ctx, plan, quality, dir, target)
	} else {
		err = s.downloadExtracted(ctx, plan, quality, dir, target)
	}
	if err != nil {
		return nil, err
	}
	if err = s.inspectOutput(ctx, target, dir); err != nil {
		return nil, err
	}
	f, err := os.Open(target)
	if err != nil {
		return nil, failure(502, "下载结果暂时无法读取")
	}
	st, err := f.Stat()
	if err != nil {
		f.Close()
		return nil, err
	}
	owned = false
	keep = true
	return &File{File: f, Size: st.Size(), cleanup: func() { _ = os.RemoveAll(dir); release() }}, nil
}

func (s *Service) downloadExtracted(ctx context.Context, plan downloadPlan, quality, dir, target string) error {
	proxy, closeProxy, err := publicProxy(ctx)
	if err != nil {
		return err
	}
	defer closeProxy()
	args := append(s.baseArgs(proxy), "--downloader", "native", "--hls-prefer-native", "--abort-on-unavailable-fragments", "--fragment-retries", "2", "--max-filesize", fmt.Sprint(s.cfg.MaxFileBytes), "--format", formatSelector(quality), "--merge-output-format", "mp4", "--remux-video", "mp4", "--output", filepath.Join(dir, "source.%(ext)s"), "--", plan.SourceURL)
	_, stderr, err := s.run(ctx, s.cfg.Command, args, dir, s.diskLimit())
	if err != nil {
		return commandError(ctx, stderr, err)
	}
	return s.finish(ctx, []string{filepath.Join(dir, "source.mp4")}, false, quality, dir, target)
}
func (s *Service) diskLimit() int64 { return s.cfg.MaxFileBytes*3 + (64 << 20) }
func (s *Service) inspectOutput(ctx context.Context, target, dir string) error {
	st, err := os.Lstat(target)
	if err != nil || !st.Mode().IsRegular() || st.Size() <= 0 {
		return failure(502, "下载没有生成有效的视频文件")
	}
	if st.Size() > s.cfg.MaxFileBytes {
		return failure(400, "视频文件超过当前下载上限")
	}
	stdout, stderr, err := s.run(ctx, s.cfg.FFprobeCommand, []string{"-v", "error", "-protocol_whitelist", "file,pipe", "-show_entries", "stream=codec_type", "-of", "json", target}, dir, s.diskLimit())
	if err != nil {
		return commandError(ctx, stderr, err)
	}
	var v struct {
		Streams []struct {
			Type string `json:"codec_type"`
		} `json:"streams"`
	}
	if json.Unmarshal(stdout, &v) == nil {
		for _, stream := range v.Streams {
			if stream.Type == "video" {
				return nil
			}
		}
	}
	return failure(502, "下载结果不是有效的视频，请重新解析")
}

func object(v any) map[string]any                     { m, _ := v.(map[string]any); return m }
func child(m map[string]any, k string) map[string]any { return object(m[k]) }
func array(m map[string]any, k string) []any          { a, _ := m[k].([]any); return a }
func str(m map[string]any, k string) string {
	switch v := m[k].(type) {
	case string:
		return strings.TrimSpace(v)
	case json.Number:
		return string(v)
	}
	return ""
}
func number(m map[string]any, k string) float64 {
	var n float64
	switch v := m[k].(type) {
	case json.Number:
		n, _ = v.Float64()
	case float64:
		n = v
	case string:
		fmt.Sscan(v, &n)
	}
	if n < 0 || math.IsNaN(n) || math.IsInf(n, 0) || n > 1e15 {
		return 0
	}
	return n
}
func firstNumber(m map[string]any, keys ...string) float64 {
	for _, k := range keys {
		if n := number(m, k); n > 0 {
			return n
		}
	}
	return 0
}
func flag(m map[string]any, k string) bool { v, _ := m[k].(bool); return v || number(m, k) > 0 }
func decodeJSON(r io.Reader) (map[string]any, error) {
	var m map[string]any
	d := json.NewDecoder(r)
	d.UseNumber()
	err := d.Decode(&m)
	return m, err
}
