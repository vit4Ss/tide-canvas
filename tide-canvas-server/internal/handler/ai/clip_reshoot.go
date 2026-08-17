package ai

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"

	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/idgen"
)

const (
	clipReshootInputKey       = "clipReshoot"
	maxClipReshootRanges      = 5
	minClipReshootRangeSecond = 0.5
	clipReshootTimeout        = 3 * time.Minute
	maxConcurrentClipReshoots = 4
)

var clipReshootSlots = make(chan struct{}, maxConcurrentClipReshoots)

type clipReshootRange struct {
	Start float64 `json:"start"`
	End   float64 `json:"end"`
}

// clipReshootSpec is client input plus server-owned normalized metadata. The
// server always overwrites DurationSeconds and OutputDuration before charging.
type clipReshootSpec struct {
	SourceURL        string             `json:"sourceUrl"`
	Ranges           []clipReshootRange `json:"ranges"`
	SourceDuration   float64            `json:"sourceDuration,omitempty"`
	DurationSeconds  float64            `json:"durationSeconds,omitempty"`
	OutputDuration   int                `json:"outputDuration,omitempty"`
	ProviderDuration int                `json:"providerDuration,omitempty"`
}

type confirmedClipReshoot struct {
	Spec        clipReshootSpec
	SourceIndex int
}

func decodeClipReshootSpec(raw any) (*clipReshootSpec, error) {
	if raw == nil {
		return nil, nil
	}
	encoded, err := json.Marshal(raw)
	if err != nil {
		return nil, err
	}
	// A nil *clipReshootSpec stored in an interface is not equal to nil. The
	// quote DTO passes exactly that shape when ordinary reference-video pricing
	// has no reshoot selection; JSON encodes it as null, which must stay absent
	// instead of becoming a zero-valued (and therefore invalid) reshoot spec.
	if string(encoded) == "null" {
		return nil, nil
	}
	var spec clipReshootSpec
	if err := json.Unmarshal(encoded, &spec); err != nil {
		return nil, err
	}
	return &spec, nil
}

// confirmClipReshoot verifies that the selected source is one of the submitted
// references, belongs to the caller, and that every range is inside the actual
// media duration. Browser-reported duration is never trusted.
func (s *service) confirmClipReshoot(
	ctx context.Context,
	userID idgen.ID,
	references []string,
	raw any,
) (*confirmedClipReshoot, error) {
	spec, err := decodeClipReshootSpec(raw)
	if err != nil || spec == nil {
		if err != nil {
			return nil, skillPlacementError{message: "片段重拍参数无效，请重新选择片段"}
		}
		return nil, nil
	}
	if s.confirmVideoDuration == nil {
		return nil, errVideoProbeUnavailable
	}
	spec.SourceURL = strings.TrimSpace(spec.SourceURL)
	if spec.SourceURL == "" || len(spec.SourceURL) > maxReferenceVideoURLBytes {
		return nil, skillPlacementError{message: "片段重拍的来源视频无效，请重新连接原视频"}
	}
	sourceIndex := -1
	for index, reference := range references {
		if strings.TrimSpace(reference) == spec.SourceURL {
			sourceIndex = index
			break
		}
	}
	if sourceIndex < 0 {
		return nil, skillPlacementError{message: "片段重拍的来源视频与参考视频不一致，请重新连接原视频"}
	}
	if len(spec.Ranges) == 0 || len(spec.Ranges) > maxClipReshootRanges {
		return nil, skillPlacementError{message: "请选择 1 至 5 个需要重拍的片段"}
	}

	canonical, sourceDuration, err := s.confirmVideoDuration(ctx, userID, spec.SourceURL)
	if err != nil {
		if errors.Is(err, errVideoProbeUnavailable) {
			return nil, err
		}
		return nil, skillPlacementError{message: "服务端无法确认片段重拍的视频，请重新选择已上传的视频"}
	}
	if strings.TrimSpace(canonical) == "" || sourceDuration <= 0 || math.IsNaN(sourceDuration) || math.IsInf(sourceDuration, 0) {
		return nil, skillPlacementError{message: "服务端无法确认片段重拍的视频时长，请重新选择视频"}
	}
	sourceDuration = math.Ceil(sourceDuration*1000) / 1000
	ranges := append([]clipReshootRange(nil), spec.Ranges...)
	sort.SliceStable(ranges, func(i, j int) bool { return ranges[i].Start < ranges[j].Start })
	selectedDuration := 0.0
	previousEnd := 0.0
	for index := range ranges {
		start := math.Round(ranges[index].Start*1000) / 1000
		end := math.Round(ranges[index].End*1000) / 1000
		if math.IsNaN(start) || math.IsInf(start, 0) || math.IsNaN(end) || math.IsInf(end, 0) ||
			start < 0 || end-start < minClipReshootRangeSecond || end > sourceDuration+0.05 {
			return nil, skillPlacementError{message: "片段重拍选区超出原视频范围，请重新选择"}
		}
		if index > 0 && start < previousEnd {
			return nil, skillPlacementError{message: "片段重拍选区不能重叠，请重新选择"}
		}
		if end > sourceDuration {
			end = sourceDuration
		}
		ranges[index] = clipReshootRange{Start: start, End: end}
		selectedDuration += end - start
		previousEnd = end
	}
	selectedDuration = math.Ceil(selectedDuration*1000) / 1000
	if selectedDuration <= 0 || math.IsNaN(selectedDuration) || math.IsInf(selectedDuration, 0) {
		return nil, skillPlacementError{message: "片段重拍选区无效，请重新选择"}
	}

	return &confirmedClipReshoot{
		Spec: clipReshootSpec{
			SourceURL:       canonical,
			Ranges:          ranges,
			SourceDuration:  sourceDuration,
			DurationSeconds: selectedDuration,
			OutputDuration:  max(1, int(math.Ceil(selectedDuration-1e-9))),
		},
		SourceIndex: sourceIndex,
	}, nil
}

// prepareClipReshootProviderInput materializes the selected ranges into a real
// standalone video. Passing the original full video with only a shorter output
// duration is insufficient: the upstream model would still see all 11 seconds.
func (s *service) prepareClipReshootProviderInput(
	ctx context.Context,
	userID idgen.ID,
	input map[string]any,
) (*clipReshootSpec, error) {
	spec, err := decodeClipReshootSpec(input[clipReshootInputKey])
	if err != nil {
		return nil, errors.New("invalid clip reshoot task input")
	}
	if spec == nil {
		return nil, nil
	}
	if s.storage == nil {
		return nil, errors.New("clip reshoot storage is unavailable")
	}
	references := inputStrings(input, "videoReferences", "video_urls")
	sourceIndex := -1
	for index, reference := range references {
		if strings.TrimSpace(reference) == strings.TrimSpace(spec.SourceURL) {
			sourceIndex = index
			break
		}
	}
	if sourceIndex < 0 {
		return nil, errors.New("clip reshoot source reference is unavailable")
	}
	clipURL, err := s.renderClipReshootReference(ctx, userID, *spec)
	if err != nil {
		return nil, fmt.Errorf("clip reshoot render failed: %w", err)
	}
	references[sourceIndex] = clipURL
	input["videoReferences"] = references
	delete(input, "video_urls")
	delete(input, clipReshootInputKey)
	return spec, nil
}

func clipReshootProviderDuration(m *model.AiModel, requested int) (int, error) {
	if requested <= 0 {
		return 0, skillPlacementError{message: "片段重拍选区时长无效，请重新选择"}
	}
	if m == nil || strings.TrimSpace(m.Config) == "" {
		return requested, nil
	}
	var config map[string]any
	if json.Unmarshal([]byte(m.Config), &config) != nil {
		return requested, nil
	}
	rawDurations, configured := config["durations"].([]any)
	if !configured || len(rawDurations) == 0 {
		return requested, nil
	}
	durations := make([]int, 0, len(rawDurations))
	for _, raw := range rawDurations {
		seconds := durationSeconds(raw)
		if seconds <= 0 || math.IsNaN(seconds) || math.IsInf(seconds, 0) {
			continue
		}
		durations = append(durations, int(math.Ceil(seconds)))
	}
	sort.Ints(durations)
	for _, duration := range durations {
		if duration >= requested {
			return duration, nil
		}
	}
	return 0, skillPlacementError{message: "选中片段总时长超过当前模型支持范围，请缩短选区或更换模型"}
}

func (s *service) composeClipReshootResult(
	ctx context.Context,
	userID idgen.ID,
	res GenerateResult,
	spec clipReshootSpec,
) (GenerateResult, error) {
	composeOne := func(replacementURL string) (string, error) {
		return s.renderClipReshootComposition(ctx, userID, spec, replacementURL)
	}
	if len(res.URLs) > 0 {
		composed := make([]string, len(res.URLs))
		for index, replacementURL := range res.URLs {
			url, err := composeOne(replacementURL)
			if err != nil {
				return res, fmt.Errorf("clip reshoot output composition failed: %w", err)
			}
			composed[index] = url
		}
		res.URLs = composed
		res.ResultURL = composed[0]
		return res, nil
	}
	if strings.TrimSpace(res.ResultURL) == "" {
		return res, nil
	}
	url, err := composeOne(res.ResultURL)
	if err != nil {
		return res, fmt.Errorf("clip reshoot output composition failed: %w", err)
	}
	res.ResultURL = url
	return res, nil
}

// renderClipReshootComposition puts the generated replacement back into the
// original timeline. The provider intentionally sees only the selected ranges,
// but the user-facing result must remain a complete video: untouched source
// sections + replacement sections + the original full-length audio track.
func (s *service) renderClipReshootComposition(
	ctx context.Context,
	userID idgen.ID,
	spec clipReshootSpec,
	replacementURL string,
) (string, error) {
	if s.storage == nil {
		return "", errors.New("clip reshoot storage is unavailable")
	}
	binary, err := exec.LookPath("ffmpeg")
	if err != nil {
		return "", fmt.Errorf("ffmpeg unavailable: %w", err)
	}
	canonicalSource, sourceOwned := s.storage.OwnsURL(strings.TrimSpace(spec.SourceURL))
	if !sourceOwned || strings.TrimSpace(canonicalSource) == "" {
		return "", errors.New("clip reshoot source is outside managed storage")
	}
	canonicalReplacement, replacementOwned := s.storage.OwnsURL(strings.TrimSpace(replacementURL))
	if !replacementOwned || strings.TrimSpace(canonicalReplacement) == "" {
		return "", errors.New("clip reshoot replacement is outside managed storage")
	}
	sourceURL := s.storage.UpstreamURL(canonicalSource)
	replacementUpstreamURL := s.storage.UpstreamURL(canonicalReplacement)
	profile, err := probeClipReshootVideoProfile(ctx, sourceURL)
	if err != nil {
		return "", err
	}
	sourceDuration := spec.SourceDuration
	if sourceDuration <= 0 || math.IsNaN(sourceDuration) || math.IsInf(sourceDuration, 0) {
		sourceDuration = profile.Duration
	}
	if sourceDuration <= 0 || math.IsNaN(sourceDuration) || math.IsInf(sourceDuration, 0) {
		return "", errors.New("clip reshoot source duration is unavailable")
	}
	filter, videoOutput, audioOutput, err := buildClipReshootCompositionFilter(
		spec.Ranges,
		sourceDuration,
		profile.Width,
		profile.Height,
		profile.FrameRate,
		profile.HasAudio,
	)
	if err != nil {
		return "", err
	}

	tmp, err := os.CreateTemp("", "tide-clip-reshoot-final-*.mp4")
	if err != nil {
		return "", err
	}
	tmpPath := tmp.Name()
	if err := tmp.Close(); err != nil {
		_ = os.Remove(tmpPath)
		return "", err
	}
	defer os.Remove(tmpPath)

	args := []string{
		"-hide_banner", "-loglevel", "error", "-y",
		"-protocol_whitelist", "http,https,tcp,tls",
		"-rw_timeout", "30000000",
		"-i", sourceURL,
		"-protocol_whitelist", "http,https,tcp,tls",
		"-rw_timeout", "30000000",
		"-i", replacementUpstreamURL,
		"-filter_complex", filter,
		"-map", videoOutput,
	}
	if profile.HasAudio {
		args = append(args, "-map", audioOutput)
	}
	args = append(args,
		"-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p",
	)
	if profile.HasAudio {
		args = append(args, "-c:a", "aac", "-b:a", "192k")
	}
	args = append(args,
		"-t", formatClipReshootSeconds(sourceDuration),
		"-movflags", "+faststart",
		tmpPath,
	)

	renderCtx, cancel := context.WithTimeout(ctx, clipReshootTimeout)
	defer cancel()
	select {
	case clipReshootSlots <- struct{}{}:
		defer func() { <-clipReshootSlots }()
	case <-renderCtx.Done():
		return "", fmt.Errorf("ffmpeg queue timeout: %w", renderCtx.Err())
	}
	stderr := cappedProbeBuffer{limit: videoProbeStderrLimit}
	cmd := exec.CommandContext(renderCtx, binary, args...)
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		if renderCtx.Err() != nil {
			return "", fmt.Errorf("ffmpeg timeout: %w", renderCtx.Err())
		}
		return "", fmt.Errorf("ffmpeg failed: %w (%s)", err, strings.TrimSpace(stderr.String()))
	}
	info, err := os.Stat(tmpPath)
	if err != nil || info.Size() <= 0 {
		return "", errors.New("ffmpeg produced an empty clip reshoot composition")
	}

	hashInput, _ := json.Marshal(struct {
		Version     int                `json:"version"`
		Source      string             `json:"source"`
		Replacement string             `json:"replacement"`
		Duration    float64            `json:"duration"`
		Ranges      []clipReshootRange `json:"ranges"`
	}{
		Version:     1,
		Source:      canonicalSource,
		Replacement: canonicalReplacement,
		Duration:    sourceDuration,
		Ranges:      spec.Ranges,
	})
	sum := sha256.Sum256(hashInput)
	key := filepath.ToSlash(filepath.Join("derived", "clip-reshoot-final", userID.String(), fmt.Sprintf("%x.mp4", sum[:16])))
	file, err := os.Open(tmpPath)
	if err != nil {
		return "", err
	}
	defer file.Close()
	return s.storage.Save(ctx, key, file, "video/mp4")
}

func (s *service) renderClipReshootReference(
	ctx context.Context,
	userID idgen.ID,
	spec clipReshootSpec,
) (string, error) {
	binary, err := exec.LookPath("ffmpeg")
	if err != nil {
		return "", fmt.Errorf("ffmpeg unavailable: %w", err)
	}
	canonical, owned := s.storage.OwnsURL(strings.TrimSpace(spec.SourceURL))
	if !owned || strings.TrimSpace(canonical) == "" {
		return "", errors.New("clip reshoot source is outside managed storage")
	}
	sourceURL := s.storage.UpstreamURL(canonical)
	hasAudio, err := probeVideoHasAudio(ctx, sourceURL)
	if err != nil {
		return "", err
	}

	tmp, err := os.CreateTemp("", "tide-clip-reshoot-*.mp4")
	if err != nil {
		return "", err
	}
	tmpPath := tmp.Name()
	if err := tmp.Close(); err != nil {
		_ = os.Remove(tmpPath)
		return "", err
	}
	defer os.Remove(tmpPath)

	filter, videoOutput, audioOutput := buildClipReshootFilter(spec.Ranges, hasAudio)
	args := []string{
		"-hide_banner", "-loglevel", "error", "-y",
		"-protocol_whitelist", "http,https,tcp,tls",
		"-rw_timeout", "30000000",
		"-i", sourceURL,
		"-filter_complex", filter,
		"-map", videoOutput,
	}
	if hasAudio {
		args = append(args, "-map", audioOutput)
	}
	args = append(args,
		"-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p",
	)
	if hasAudio {
		args = append(args, "-c:a", "aac", "-b:a", "192k")
	}
	args = append(args, "-movflags", "+faststart", tmpPath)

	renderCtx, cancel := context.WithTimeout(ctx, clipReshootTimeout)
	defer cancel()
	select {
	case clipReshootSlots <- struct{}{}:
		defer func() { <-clipReshootSlots }()
	case <-renderCtx.Done():
		return "", fmt.Errorf("ffmpeg queue timeout: %w", renderCtx.Err())
	}
	stderr := cappedProbeBuffer{limit: videoProbeStderrLimit}
	cmd := exec.CommandContext(renderCtx, binary, args...)
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		if renderCtx.Err() != nil {
			return "", fmt.Errorf("ffmpeg timeout: %w", renderCtx.Err())
		}
		return "", fmt.Errorf("ffmpeg failed: %w (%s)", err, strings.TrimSpace(stderr.String()))
	}
	info, err := os.Stat(tmpPath)
	if err != nil || info.Size() <= 0 {
		return "", errors.New("ffmpeg produced an empty clip")
	}

	hashInput, _ := json.Marshal(struct {
		Source string             `json:"source"`
		Ranges []clipReshootRange `json:"ranges"`
	}{Source: canonical, Ranges: spec.Ranges})
	sum := sha256.Sum256(hashInput)
	key := filepath.ToSlash(filepath.Join("derived", "clip-reshoot", userID.String(), fmt.Sprintf("%x.mp4", sum[:16])))
	file, err := os.Open(tmpPath)
	if err != nil {
		return "", err
	}
	defer file.Close()
	return s.storage.Save(ctx, key, file, "video/mp4")
}

func buildClipReshootFilter(ranges []clipReshootRange, hasAudio bool) (filter, videoOutput, audioOutput string) {
	parts := make([]string, 0, len(ranges)*2+1)
	inputs := make([]string, 0, len(ranges)*2)
	for index, selected := range ranges {
		start := strconv.FormatFloat(selected.Start, 'f', 3, 64)
		end := strconv.FormatFloat(selected.End, 'f', 3, 64)
		videoLabel := fmt.Sprintf("v%d", index)
		parts = append(parts, fmt.Sprintf("[0:v:0]trim=start=%s:end=%s,setpts=PTS-STARTPTS[%s]", start, end, videoLabel))
		inputs = append(inputs, "["+videoLabel+"]")
		if hasAudio {
			audioLabel := fmt.Sprintf("a%d", index)
			parts = append(parts, fmt.Sprintf("[0:a:0]atrim=start=%s:end=%s,asetpts=PTS-STARTPTS[%s]", start, end, audioLabel))
			inputs = append(inputs, "["+audioLabel+"]")
		}
	}
	videoOutput = "[clipv]"
	if hasAudio {
		audioOutput = "[clipa]"
		parts = append(parts, strings.Join(inputs, "")+fmt.Sprintf("concat=n=%d:v=1:a=1%s%s", len(ranges), videoOutput, audioOutput))
	} else {
		parts = append(parts, strings.Join(inputs, "")+fmt.Sprintf("concat=n=%d:v=1:a=0%s", len(ranges), videoOutput))
	}
	return strings.Join(parts, ";"), videoOutput, audioOutput
}

type clipReshootVideoProfile struct {
	Width     int
	Height    int
	Duration  float64
	FrameRate float64
	HasAudio  bool
}

func buildClipReshootCompositionFilter(
	ranges []clipReshootRange,
	sourceDuration float64,
	width int,
	height int,
	frameRate float64,
	hasAudio bool,
) (filter, videoOutput, audioOutput string, err error) {
	if len(ranges) == 0 || sourceDuration <= 0 || math.IsNaN(sourceDuration) || math.IsInf(sourceDuration, 0) {
		return "", "", "", errors.New("clip reshoot composition has no valid timeline")
	}
	// H.264 yuv420p requires even dimensions. Losing at most one edge pixel is
	// preferable to stretching the generated replacement or failing the task.
	width -= width % 2
	height -= height % 2
	if width < 2 || height < 2 {
		return "", "", "", errors.New("clip reshoot source dimensions are unavailable")
	}
	if frameRate <= 0 || math.IsNaN(frameRate) || math.IsInf(frameRate, 0) {
		frameRate = 30
	}

	selectedDuration := 0.0
	previousEnd := 0.0
	for index, selected := range ranges {
		if selected.Start < previousEnd || selected.Start < 0 || selected.End <= selected.Start || selected.End > sourceDuration+0.05 {
			return "", "", "", errors.New("clip reshoot composition ranges are invalid")
		}
		if index > 0 && selected.Start < ranges[index-1].End {
			return "", "", "", errors.New("clip reshoot composition ranges overlap")
		}
		selectedDuration += selected.End - selected.Start
		previousEnd = selected.End
	}
	if selectedDuration <= 0 {
		return "", "", "", errors.New("clip reshoot composition duration is invalid")
	}

	normalizeVideo := fmt.Sprintf(
		",scale=%d:%d:force_original_aspect_ratio=decrease,pad=%d:%d:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=%.3f,format=yuv420p",
		width, height, width, height, frameRate,
	)
	parts := make([]string, 0, len(ranges)*2+3)
	videoInputs := make([]string, 0, len(ranges)*2+1)
	segmentIndex := 0
	appendSourceSegment := func(start, end float64) {
		label := fmt.Sprintf("finalv%d", segmentIndex)
		parts = append(parts, fmt.Sprintf(
			"[0:v:0]trim=start=%s:end=%s,setpts=PTS-STARTPTS%s[%s]",
			formatClipReshootSeconds(start), formatClipReshootSeconds(end), normalizeVideo, label,
		))
		videoInputs = append(videoInputs, "["+label+"]")
		segmentIndex++
	}
	appendReplacementSegment := func(start, end float64) {
		label := fmt.Sprintf("finalv%d", segmentIndex)
		parts = append(parts, fmt.Sprintf(
			"[1:v:0]setpts=PTS-STARTPTS,tpad=stop_mode=clone:stop_duration=%s,trim=start=%s:end=%s,setpts=PTS-STARTPTS%s[%s]",
			formatClipReshootSeconds(selectedDuration), formatClipReshootSeconds(start), formatClipReshootSeconds(end), normalizeVideo, label,
		))
		videoInputs = append(videoInputs, "["+label+"]")
		segmentIndex++
	}

	sourceCursor := 0.0
	replacementCursor := 0.0
	for _, selected := range ranges {
		if selected.Start-sourceCursor > 0.0005 {
			appendSourceSegment(sourceCursor, selected.Start)
		}
		rangeDuration := selected.End - selected.Start
		appendReplacementSegment(replacementCursor, replacementCursor+rangeDuration)
		replacementCursor += rangeDuration
		sourceCursor = selected.End
	}
	if sourceDuration-sourceCursor > 0.0005 {
		appendSourceSegment(sourceCursor, sourceDuration)
	}

	videoOutput = "[clipv]"
	if len(videoInputs) == 1 {
		parts = append(parts, videoInputs[0]+"null"+videoOutput)
	} else {
		parts = append(parts, strings.Join(videoInputs, "")+fmt.Sprintf("concat=n=%d:v=1:a=0%s", len(videoInputs), videoOutput))
	}
	if hasAudio {
		audioOutput = "[clipa]"
		parts = append(parts, fmt.Sprintf(
			"[0:a:0]atrim=start=0:end=%s,asetpts=PTS-STARTPTS%s",
			formatClipReshootSeconds(sourceDuration), audioOutput,
		))
	}
	return strings.Join(parts, ";"), videoOutput, audioOutput, nil
}

func formatClipReshootSeconds(seconds float64) string {
	return strconv.FormatFloat(seconds, 'f', 3, 64)
}

func probeClipReshootVideoProfile(ctx context.Context, sourceURL string) (clipReshootVideoProfile, error) {
	binary, err := exec.LookPath("ffprobe")
	if err != nil {
		return clipReshootVideoProfile{}, fmt.Errorf("%w: %v", errVideoProbeUnavailable, err)
	}
	probeCtx, cancel := context.WithTimeout(ctx, videoProbeTimeout)
	defer cancel()
	select {
	case videoProbeSlots <- struct{}{}:
		defer func() { <-videoProbeSlots }()
	case <-probeCtx.Done():
		return clipReshootVideoProfile{}, fmt.Errorf("ffprobe queue timeout: %w", probeCtx.Err())
	}
	cmd := exec.CommandContext(probeCtx, binary,
		"-v", "error",
		"-protocol_whitelist", "http,https,tcp,tls",
		"-rw_timeout", "30000000",
		"-show_entries", "stream=codec_type,width,height,avg_frame_rate,duration:format=duration",
		"-of", "json",
		strings.TrimSpace(sourceURL),
	)
	stdout := cappedProbeBuffer{limit: videoProbeStdoutLimit}
	stderr := cappedProbeBuffer{limit: videoProbeStderrLimit}
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		if probeCtx.Err() != nil {
			return clipReshootVideoProfile{}, fmt.Errorf("ffprobe timeout: %w", probeCtx.Err())
		}
		return clipReshootVideoProfile{}, fmt.Errorf("ffprobe failed: %w (%s)", err, strings.TrimSpace(stderr.String()))
	}
	var payload struct {
		Streams []struct {
			CodecType    string `json:"codec_type"`
			Width        int    `json:"width"`
			Height       int    `json:"height"`
			AvgFrameRate string `json:"avg_frame_rate"`
			Duration     string `json:"duration"`
		} `json:"streams"`
		Format struct {
			Duration string `json:"duration"`
		} `json:"format"`
	}
	if err := json.Unmarshal(stdout.Bytes(), &payload); err != nil {
		return clipReshootVideoProfile{}, errors.New("ffprobe returned an invalid clip reshoot profile")
	}
	profile := clipReshootVideoProfile{Duration: validProbeDuration(payload.Format.Duration)}
	for _, stream := range payload.Streams {
		switch stream.CodecType {
		case "video":
			profile.Duration = math.Max(profile.Duration, validProbeDuration(stream.Duration))
			if profile.Width == 0 && stream.Width > 0 && stream.Height > 0 {
				profile.Width = stream.Width
				profile.Height = stream.Height
				profile.FrameRate = parseClipReshootFrameRate(stream.AvgFrameRate)
			}
		case "audio":
			profile.HasAudio = true
		}
	}
	if profile.Width <= 0 || profile.Height <= 0 || profile.Duration <= 0 {
		return clipReshootVideoProfile{}, errors.New("ffprobe returned an incomplete clip reshoot profile")
	}
	return profile, nil
}

func parseClipReshootFrameRate(raw string) float64 {
	parts := strings.Split(strings.TrimSpace(raw), "/")
	if len(parts) == 2 {
		numerator, numeratorErr := strconv.ParseFloat(parts[0], 64)
		denominator, denominatorErr := strconv.ParseFloat(parts[1], 64)
		if numeratorErr == nil && denominatorErr == nil && denominator > 0 {
			value := numerator / denominator
			if value >= 1 && value <= 240 {
				return value
			}
		}
	}
	value, err := strconv.ParseFloat(strings.TrimSpace(raw), 64)
	if err == nil && value >= 1 && value <= 240 {
		return value
	}
	return 0
}

func probeVideoHasAudio(ctx context.Context, sourceURL string) (bool, error) {
	binary, err := exec.LookPath("ffprobe")
	if err != nil {
		return false, fmt.Errorf("%w: %v", errVideoProbeUnavailable, err)
	}
	probeCtx, cancel := context.WithTimeout(ctx, videoProbeTimeout)
	defer cancel()
	select {
	case videoProbeSlots <- struct{}{}:
		defer func() { <-videoProbeSlots }()
	case <-probeCtx.Done():
		return false, fmt.Errorf("ffprobe queue timeout: %w", probeCtx.Err())
	}
	cmd := exec.CommandContext(probeCtx, binary,
		"-v", "error",
		"-protocol_whitelist", "http,https,tcp,tls",
		"-rw_timeout", "30000000",
		"-select_streams", "a:0",
		"-show_entries", "stream=index",
		"-of", "csv=p=0",
		strings.TrimSpace(sourceURL),
	)
	stdout := cappedProbeBuffer{limit: videoProbeStdoutLimit}
	stderr := cappedProbeBuffer{limit: videoProbeStderrLimit}
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		if probeCtx.Err() != nil {
			return false, fmt.Errorf("ffprobe timeout: %w", probeCtx.Err())
		}
		return false, fmt.Errorf("ffprobe failed: %w (%s)", err, strings.TrimSpace(stderr.String()))
	}
	return strings.TrimSpace(stdout.String()) != "", nil
}
