package ai

// user_history.go defines the deliberately small public contract used by the
// account and canvas history UIs. Generation audit rows contain provider URLs,
// request/response bodies, HTTP status, upstream ids and raw errors; none of
// those fields belong in a user-facing response. Keep this DTO as an explicit
// allowlist instead of redacting the much larger AiGenerationLogVO.

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"

	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/idgen"
)

type UserHistoryAssetVO struct {
	URL  string `json:"url"`
	Kind string `json:"kind"`
	Name string `json:"name,omitempty"`
}

type UserHistoryParameterVO struct {
	Key   string `json:"key"`
	Value string `json:"value"`
}

// UserGenerationHistoryVO is a product record, not a serialized audit log.
// ID is an opaque record key used only to request the corresponding safe
// detail view.
type UserGenerationHistoryVO struct {
	ID         idgen.ID `json:"id"`
	MediaType  string   `json:"mediaType"`
	Model      string   `json:"model"`
	Prompt     string   `json:"prompt"`
	Success    int      `json:"success"`
	ResultURL  string   `json:"resultUrl,omitempty"`
	DurationMs int64    `json:"durationMs"`
	CreateTime string   `json:"createTime"`
	PointCost  *int64   `json:"pointCost,omitempty"`
}

type UserGenerationHistoryDetailVO struct {
	MediaType     string                   `json:"mediaType"`
	Model         string                   `json:"model"`
	Prompt        string                   `json:"prompt"`
	Success       int                      `json:"success"`
	DurationMs    int64                    `json:"durationMs"`
	CreateTime    string                   `json:"createTime"`
	CompleteTime  string                   `json:"completeTime,omitempty"`
	PointCost     *int64                   `json:"pointCost,omitempty"`
	FailureReason string                   `json:"failureReason,omitempty"`
	ResultAssets  []UserHistoryAssetVO     `json:"resultAssets"`
	ResultText    string                   `json:"resultText,omitempty"`
	InputAssets   []UserHistoryAssetVO     `json:"inputAssets"`
	Parameters    []UserHistoryParameterVO `json:"parameters"`
}

func userHistoryMediaType(handler, operation string) string {
	handler = strings.ToLower(strings.TrimSpace(handler))
	operation = strings.ToLower(strings.TrimSpace(operation))
	switch {
	case handler == "text_to_audio" || operation == "audio":
		return "audio"
	case handler == "generate_3d" || operation == "3d":
		return "3d"
	case handler == assistantChatHandler || handler == skillTextCompletionHandler || operation == "chat" || operation == "text":
		return "text"
	case strings.Contains(handler, "video") || operation == "video" || operation == "upscale":
		return "video"
	default:
		return "image"
	}
}

func toUserHistoryVO(log *model.AiGenerationLog, state *taskLogState) UserGenerationHistoryVO {
	vo := UserGenerationHistoryVO{
		ID:         log.ID,
		MediaType:  userHistoryMediaType(log.HandlerName, log.OperationType),
		Model:      log.Model,
		Prompt:     generationPromptExcerpt(log.InputParams, 200),
		Success:    log.Success,
		ResultURL:  log.ResultUrl,
		DurationMs: log.DurationMs,
		CreateTime: fmtTime(log.CreateTime),
	}
	if state != nil {
		cost := state.PointCost
		vo.PointCost = &cost
		if state.Status == statusSuccess {
			vo.Success = 1
		} else if state.Status == statusFailed || state.Status == statusCancelled {
			vo.Success = 0
		}
	}
	return vo
}

func (s *service) listUserHistory(ctx context.Context, userID idgen.ID, q userHistoryQuery, offset, limit int) ([]UserGenerationHistoryVO, int64, error) {
	rows, total, err := s.repo.listLogs(ctx, userID, false, logQuery{
		PageNum: q.PageNum, PageSize: q.PageSize, ProjectID: q.ProjectID,
		MediaType: q.MediaType, Keyword: q.Keyword, Success: q.Success,
		StartDate: q.StartDate, EndDate: q.EndDate,
	}, offset, limit)
	if err != nil {
		return nil, 0, err
	}

	taskIDs := make([]idgen.ID, 0, len(rows))
	for i := range rows {
		if rows[i].TaskID != 0 {
			taskIDs = append(taskIDs, rows[i].TaskID)
		}
	}
	states, _ := s.repo.taskLogStates(ctx, taskIDs)
	out := make([]UserGenerationHistoryVO, 0, len(rows))
	for i := range rows {
		var state *taskLogState
		if current, ok := states[rows[i].TaskID]; ok {
			state = &current
		}
		out = append(out, toUserHistoryVO(&rows[i], state))
	}
	return out, total, nil
}

func (s *service) getUserHistory(ctx context.Context, userID, recordID idgen.ID) (*UserGenerationHistoryDetailVO, error) {
	log, err := s.repo.getUserLog(ctx, userID, recordID)
	if err != nil {
		return nil, err
	}
	if log == nil {
		return nil, errTaskNotFound
	}

	var task *model.AiTask
	if log.TaskID != 0 {
		candidate, taskErr := s.repo.getTask(ctx, log.TaskID)
		if taskErr != nil {
			return nil, taskErr
		}
		if candidate != nil && candidate.UserID == userID {
			task = candidate
		}
	}
	detail := toUserHistoryDetail(log, task)
	return &detail, nil
}

func toUserHistoryDetail(log *model.AiGenerationLog, task *model.AiTask) UserGenerationHistoryDetailVO {
	mediaType := userHistoryMediaType(log.HandlerName, log.OperationType)
	detail := UserGenerationHistoryDetailVO{
		MediaType:    mediaType,
		Model:        log.Model,
		Prompt:       generationPromptExcerpt(log.InputParams, 4000),
		Success:      log.Success,
		DurationMs:   log.DurationMs,
		CreateTime:   fmtTime(log.CreateTime),
		ResultAssets: []UserHistoryAssetVO{},
		InputAssets:  []UserHistoryAssetVO{},
		Parameters:   []UserHistoryParameterVO{},
	}
	if log.Success != 1 {
		detail.FailureReason = publicHistoryFailureReason(log.ErrorMsg)
	}

	if task == nil {
		if url := strings.TrimSpace(log.ResultUrl); url != "" {
			detail.ResultAssets = append(detail.ResultAssets, UserHistoryAssetVO{URL: url, Kind: assetKindForURL(url, mediaType)})
		}
		return detail
	}

	detail.Model = firstNonEmpty(task.ModelName, detail.Model)
	detail.Prompt = firstNonEmpty(generationPromptExcerpt(task.Input, 4000), detail.Prompt)
	detail.CompleteTime = fmtTimePtr(task.CompleteTime)
	cost := task.PointCost
	detail.PointCost = &cost
	if task.Status == statusSuccess {
		detail.Success = 1
		detail.FailureReason = ""
	} else if task.Status == statusFailed {
		detail.Success = 0
		detail.FailureReason = publicHistoryFailureReason(task.ErrorMsg)
	} else if task.Status == statusCancelled {
		detail.Success = 0
		detail.FailureReason = "任务已取消，未生成结果"
	}
	detail.ResultAssets, detail.ResultText = publicTaskResults(task, mediaType)
	detail.InputAssets = publicInputAssets(task.Input)
	detail.Parameters = publicInputParameters(task.Input)
	return detail
}

// publicHistoryFailureReason returns only product-authored failure copy. New
// tasks already persist userFacingGenError output, while old rows may contain
// raw provider or relay details. Preserve exact messages emitted by our own
// classifier, reclassify recognizable legacy errors, and fail closed for
// everything else so credentials, internal URLs and provider payloads never
// enter the user history contract.
func publicHistoryFailureReason(raw string) string {
	message := strings.TrimSpace(raw)
	if message == "" {
		return userFacingGenErr
	}
	if isKnownUserFacingGenMessage(message) {
		return message
	}
	if classified := userFacingGenError(errors.New(message)); classified != userFacingGenErr {
		return classified
	}
	return userFacingGenErr
}

func isKnownUserFacingGenMessage(message string) bool {
	switch message {
	case userFacingGenErr, userFacingSafetyErr, userFacingReferenceRiskErr, userFacingCopyrightErr:
		return true
	}
	for _, rule := range inputErrorRules {
		if message == rule.message {
			return true
		}
	}
	return false
}

func publicTaskResults(task *model.AiTask, mediaType string) ([]UserHistoryAssetVO, string) {
	out := make([]UserHistoryAssetVO, 0)
	seen := map[string]bool{}
	add := func(rawURL, kind, name string) {
		rawURL = strings.TrimSpace(rawURL)
		if rawURL == "" || seen[rawURL] || !isPublicHistoryURL(rawURL) {
			return
		}
		seen[rawURL] = true
		out = append(out, UserHistoryAssetVO{URL: rawURL, Kind: assetKindForURL(rawURL, kind), Name: strings.TrimSpace(name)})
	}

	var meta map[string]any
	_ = json.Unmarshal([]byte(strings.TrimSpace(task.ResultMeta)), &meta)
	if tracks, ok := meta["tracks"].([]any); ok {
		for _, raw := range tracks {
			item, _ := raw.(map[string]any)
			add(stringValue(item["url"]), "audio", stringValue(item["title"]))
		}
	}
	if assets, ok := meta["assets"].([]any); ok {
		for _, raw := range assets {
			item, _ := raw.(map[string]any)
			add(stringValue(item["url"]), "file", stringValue(item["type"]))
		}
	}
	if urls, ok := meta["urls"].([]any); ok {
		for _, raw := range urls {
			add(stringValue(raw), mediaType, "")
		}
	}
	add(task.ResultUrl, mediaType, "")
	return out, truncateRunes(strings.TrimSpace(stringValue(meta["text"])), 10000)
}

var publicInputAssetKinds = map[string]string{
	"sourceImage": "image", "imageUrl": "image", "image_url": "image",
	"imageList": "image", "imageUrls": "image", "image_urls": "image",
	"references": "image", "firstFrame": "image", "lastFrame": "image",
	"startImageUrl": "image", "endImageUrl": "image", "multiViewImages": "image",
	"videoUrl": "video", "video_url": "video", "videoUrls": "video",
	"video_urls": "video", "videoReferences": "video",
	"audioUrl": "audio", "audio_url": "audio", "audioUrls": "audio",
	"audio_urls": "audio", "audioReferences": "audio",
	"files": "file", "file": "file", "documents": "file",
}

func publicInputAssets(raw string) []UserHistoryAssetVO {
	var input map[string]any
	if json.Unmarshal([]byte(strings.TrimSpace(raw)), &input) != nil {
		return []UserHistoryAssetVO{}
	}
	keys := make([]string, 0, len(publicInputAssetKinds))
	for key := range publicInputAssetKinds {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	out := make([]UserHistoryAssetVO, 0)
	seen := map[string]bool{}
	for _, key := range keys {
		value, ok := input[key]
		if !ok {
			continue
		}
		collectPublicAssets(value, publicInputAssetKinds[key], &out, seen)
	}
	return out
}

func collectPublicAssets(value any, fallbackKind string, out *[]UserHistoryAssetVO, seen map[string]bool) {
	switch current := value.(type) {
	case string:
		if !isPublicHistoryURL(current) || seen[current] {
			return
		}
		seen[current] = true
		*out = append(*out, UserHistoryAssetVO{URL: current, Kind: assetKindForURL(current, fallbackKind)})
	case []any:
		for _, item := range current {
			collectPublicAssets(item, fallbackKind, out, seen)
		}
	case map[string]any:
		rawURL := firstNonEmpty(stringValue(current["url"]), stringValue(current["src"]), stringValue(current["href"]))
		if rawURL != "" {
			if !isPublicHistoryURL(rawURL) || seen[rawURL] {
				return
			}
			seen[rawURL] = true
			hint := firstNonEmpty(stringValue(current["kind"]), stringValue(current["type"]), stringValue(current["mimeType"]), stringValue(current["mime_type"]), fallbackKind)
			name := firstNonEmpty(stringValue(current["name"]), stringValue(current["title"]), stringValue(current["fileName"]), stringValue(current["filename"]))
			*out = append(*out, UserHistoryAssetVO{URL: rawURL, Kind: assetKindForURL(rawURL, hint), Name: name})
			return
		}
		for _, nested := range current {
			collectPublicAssets(nested, fallbackKind, out, seen)
		}
	}
}

var publicParameterKeys = []string{
	"ratio", "aspectRatio", "aspect_ratio", "resolution", "targetResolution", "target_resolution",
	"duration", "count", "size", "quality", "fps", "seed", "style", "cameraFixed", "camera_fixed",
	"width", "height", "steps", "cfgScale", "outputFormat",
}

func publicInputParameters(raw string) []UserHistoryParameterVO {
	var input map[string]any
	if json.Unmarshal([]byte(strings.TrimSpace(raw)), &input) != nil {
		return []UserHistoryParameterVO{}
	}
	out := make([]UserHistoryParameterVO, 0, len(publicParameterKeys))
	for _, key := range publicParameterKeys {
		value, ok := input[key]
		if !ok {
			continue
		}
		var display string
		switch current := value.(type) {
		case string:
			display = strings.TrimSpace(current)
		case float64, bool:
			display = fmt.Sprint(current)
		}
		if display == "" || len([]rune(display)) > 80 || isPublicHistoryURL(display) {
			continue
		}
		out = append(out, UserHistoryParameterVO{Key: key, Value: display})
	}
	return out
}

func assetKindForURL(rawURL, hint string) string {
	hint = strings.ToLower(strings.TrimSpace(hint))
	clean := strings.ToLower(strings.Split(strings.Split(rawURL, "?")[0], "#")[0])
	switch {
	case strings.HasSuffix(clean, ".mp4"), strings.HasSuffix(clean, ".mov"), strings.HasSuffix(clean, ".webm"), strings.Contains(hint, "video"):
		return "video"
	case strings.HasSuffix(clean, ".mp3"), strings.HasSuffix(clean, ".wav"), strings.HasSuffix(clean, ".m4a"), strings.HasSuffix(clean, ".ogg"), strings.HasSuffix(clean, ".aac"), strings.HasSuffix(clean, ".flac"), strings.Contains(hint, "audio"):
		return "audio"
	case strings.HasSuffix(clean, ".png"), strings.HasSuffix(clean, ".jpg"), strings.HasSuffix(clean, ".jpeg"), strings.HasSuffix(clean, ".webp"), strings.HasSuffix(clean, ".gif"), strings.HasSuffix(clean, ".avif"), strings.Contains(hint, "image"), strings.Contains(hint, "frame"):
		return "image"
	default:
		return "file"
	}
}

func isPublicHistoryURL(value string) bool {
	lower := strings.ToLower(strings.TrimSpace(value))
	return strings.HasPrefix(lower, "https://") || strings.HasPrefix(lower, "http://")
}

func stringValue(value any) string {
	text, _ := value.(string)
	return strings.TrimSpace(text)
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}
