package videodownload

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
)

func (s *Service) fetch(ctx context.Context, raw, referer string) ([]byte, *url.URL, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, raw, nil)
	if err != nil {
		return nil, nil, err
	}
	req.Header.Set("User-Agent", userAgent)
	req.Header.Set("Referer", referer)
	req.Header.Set("Accept", "application/json,text/html;q=0.9,*/*;q=0.5")
	resp, err := s.client.Do(req)
	if err != nil {
		return nil, nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode == 404 || resp.StatusCode == 401 || resp.StatusCode == 403 {
		return nil, nil, failure(400, "视频无法公开访问：可能已删除、受地区限制或需要登录")
	}
	if resp.StatusCode != 200 {
		return nil, nil, failure(502, "视频平台暂时无法提供公开数据")
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, 8<<20+1))
	if err != nil {
		return nil, nil, err
	}
	if len(data) > 8<<20 {
		return nil, nil, failure(502, "平台返回的数据超过解析限制")
	}
	return data, resp.Request.URL, nil
}
func (s *Service) fetchJSON(ctx context.Context, raw, referer string) (map[string]any, error) {
	body, _, err := s.fetch(ctx, raw, referer)
	if err != nil {
		return nil, err
	}
	return decodeJSON(strings.NewReader(string(body)))
}

func (s *Service) downloadPart(ctx context.Context, part mediaPart, platform, source, target string, maxBytes int64) error {
	if part.Size > maxBytes {
		return failure(400, "视频超过当前下载上限")
	}
	for _, raw := range part.URLs {
		trusted := trustedMedia(raw, platform)
		if trusted == "" {
			continue
		}
		err := s.copyMedia(ctx, trusted, source, target, maxBytes)
		if err == nil {
			return nil
		}
		if ctx.Err() != nil {
			return failure(504, "视频下载超时或已取消")
		}
		if e, ok := err.(*Error); ok && e.Status == 413 {
			return err
		}
	}
	return failure(502, "视频地址暂时不可用，请重新解析后下载")
}
func (s *Service) copyMedia(ctx context.Context, raw, source, target string, maxBytes int64) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, raw, nil)
	if err != nil {
		return err
	}
	req.Header.Set("User-Agent", userAgent)
	req.Header.Set("Referer", source)
	resp, err := s.client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return failure(502, "视频地址暂时不可用")
	}
	if resp.ContentLength > maxBytes {
		return failure(413, "视频超过当前下载上限，请选择更低画质")
	}
	ct := strings.ToLower(resp.Header.Get("Content-Type"))
	if strings.Contains(ct, "json") || strings.HasPrefix(ct, "text/") {
		return failure(502, "平台返回的内容不是视频")
	}
	f, err := os.OpenFile(target, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0600)
	if err != nil {
		return err
	}
	n, copyErr := io.Copy(f, io.LimitReader(resp.Body, maxBytes+1))
	closeErr := f.Close()
	if n > maxBytes {
		return failure(413, "视频超过当前下载上限，请选择更低画质")
	}
	if copyErr != nil {
		return copyErr
	}
	if closeErr != nil {
		return closeErr
	}
	if n == 0 || resp.ContentLength >= 0 && n != resp.ContentLength {
		return failure(502, "平台视频传输不完整，请重试")
	}
	return nil
}
func (s *Service) downloadDirect(ctx context.Context, plan downloadPlan, quality, dir, target string) error {
	inputs := []string{}
	remaining := s.cfg.MaxFileBytes
	if len(plan.Parts) > 32 {
		return failure(400, "视频分段过多，暂不支持下载")
	}
	for i, part := range plan.Parts {
		name := filepath.Join(dir, fmt.Sprintf("part-%02d.mp4", i))
		if err := s.downloadPart(ctx, part, plan.Platform, plan.SourceURL, name, remaining); err != nil {
			return err
		}
		st, err := os.Stat(name)
		if err != nil {
			return err
		}
		remaining -= st.Size()
		inputs = append(inputs, name)
	}
	if plan.Audio != nil {
		name := filepath.Join(dir, "audio.m4a")
		if err := s.downloadPart(ctx, *plan.Audio, plan.Platform, plan.SourceURL, name, remaining); err != nil {
			return err
		}
		inputs = append(inputs, name)
	}
	return s.finish(ctx, inputs, plan.Audio != nil, quality, dir, target)
}

func (s *Service) finish(ctx context.Context, inputs []string, hasAudio bool, quality, dir, target string) error {
	if len(inputs) == 0 {
		return failure(502, "平台没有提供可下载的视频")
	}
	// Probe local files only: FFmpeg never sees an arbitrary remote URL or manifest.
	probe, stderr, err := s.run(ctx, s.cfg.FFprobeCommand, []string{"-v", "error", "-protocol_whitelist", "file,pipe", "-show_entries", "stream=codec_type,codec_name,pix_fmt,width,height", "-of", "json", inputs[0]}, dir, s.diskLimit())
	if err != nil {
		return commandError(ctx, stderr, err)
	}
	var data struct {
		Streams []struct {
			Type   string `json:"codec_type"`
			Codec  string `json:"codec_name"`
			Pixel  string `json:"pix_fmt"`
			Height int    `json:"height"`
			Width  int    `json:"width"`
		} `json:"streams"`
	}
	if json.Unmarshal(probe, &data) != nil {
		return failure(502, "视频媒体信息无效")
	}
	height := 0
	codec := ""
	pixel := ""
	for _, st := range data.Streams {
		if st.Type == "video" {
			height = st.Height
			codec = st.Codec
			pixel = st.Pixel
			break
		}
	}
	if height <= 0 || codec == "" {
		return failure(502, "下载结果不含有效视频画面")
	}
	capHeight := 0
	if quality == "compat" {
		capHeight = 1080
	}
	if quality == "speed" {
		capHeight = 480
	}
	transcode := capHeight > 0 && height > capHeight || quality == "compat" && (codec != "h264" || pixel != "" && pixel != "yuv420p" && pixel != "yuvj420p")
	// The concat demuxer can stop on a damaged later part after producing a
	// playable prefix and still exit successfully. Treat input/decode errors
	// as fatal, so callers never deliver that prefix as the complete video.
	args := []string{"-nostdin", "-hide_banner", "-loglevel", "error", "-xerror", "-y"}
	if len(inputs) > 1 && !hasAudio {
		var list strings.Builder
		for _, file := range inputs {
			fmt.Fprintf(&list, "file '%s'\n", filepath.Base(file))
		}
		concat := filepath.Join(dir, "parts.txt")
		if err := os.WriteFile(concat, []byte(list.String()), 0600); err != nil {
			return err
		}
		args = append(args, "-protocol_whitelist", "file,pipe", "-f", "concat", "-safe", "1", "-i", concat)
	} else {
		for _, input := range inputs {
			args = append(args, "-protocol_whitelist", "file,pipe", "-i", input)
		}
	}
	args = append(args, "-map", "0:v:0")
	if hasAudio {
		args = append(args, "-map", "1:a:0")
	} else {
		args = append(args, "-map", "0:a:0?")
	}
	if transcode {
		args = append(args, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "veryfast", "-crf", "21", "-threads", "2")
		if height > capHeight && capHeight > 0 {
			args = append(args, "-vf", fmt.Sprintf("scale=-2:%d", capHeight))
		} else {
			args = append(args, "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2")
		}
	} else {
		args = append(args, "-c:v", "copy")
	}
	// AAC also handles DASH's Opus/FLAC fallback and keeps MP4 widely playable.
	args = append(args, "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", target)
	_, stderr, err = s.run(ctx, s.cfg.FFmpegCommand, args, dir, s.diskLimit())
	if err != nil {
		return commandError(ctx, stderr, err)
	}
	return nil
}
