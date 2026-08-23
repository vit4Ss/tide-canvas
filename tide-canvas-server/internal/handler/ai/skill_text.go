package ai

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"path"
	"regexp"
	"strings"
	"time"

	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/eventlog"
	"tidecanvas/internal/pkg/idgen"
	"tidecanvas/internal/pkg/relaychat"
)

// skillTextCompletionHandler is a generic, task-backed text completion used by
// SkillRun agent/workflow steps. Unlike assistant_chat it has no hard-coded
// persona or conversation persistence; billing, task lifecycle and audit still
// go through the regular AI generation service.
const skillTextCompletionHandler = "skill_text_completion"

type skillTextInput struct {
	SystemPrompt string `json:"systemPrompt"`
	Prompt       string `json:"prompt"`
	StrictJSON   bool   `json:"strictJson"`
	WebSearch    bool   `json:"webSearch"`
	AnalysisKind string `json:"analysisKind"`
	Messages     []struct {
		Role    string `json:"role"`
		Content string `json:"content"`
	} `json:"messages"`
	ImageURLs []string `json:"imageUrls"`
	Files     []struct {
		Filename string `json:"filename"`
		DataURI  string `json:"dataUri"`
		URL      string `json:"url"`
		MimeType string `json:"mimeType"`
	} `json:"files"`
	TemporaryStorageKeys []string `json:"temporaryStorageKeys"`
}

func (s *service) runSkillTextCompletion(ctx context.Context, userID idgen.ID, m *model.AiModel, effectiveInput map[string]any, pointCost int64) (GenerateResult, error) {
	if s.relay == nil {
		return GenerateResult{}, errors.New("text model relay is not configured")
	}
	raw, _ := json.Marshal(effectiveInput)
	var in skillTextInput
	if err := json.Unmarshal(raw, &in); err != nil {
		return GenerateResult{}, errors.New("invalid text completion input")
	}
	modelKey := ""
	if m != nil {
		modelKey = strings.TrimSpace(m.ModelID)
	}
	if modelKey == "" {
		return GenerateResult{}, errors.New("text model is required")
	}
	defer s.cleanupSkillTextTemporaryFiles(userID, in.TemporaryStorageKeys)

	msgs := make([]relaychat.Msg, 0, len(in.Messages)+2)
	if p := strings.TrimSpace(in.SystemPrompt); p != "" {
		msgs = append(msgs, relaychat.TextMsg("system", p))
	}
	for _, item := range in.Messages {
		role := strings.ToLower(strings.TrimSpace(item.Role))
		if role != "system" && role != "assistant" && role != "user" {
			role = "user"
		}
		if content := strings.TrimSpace(item.Content); content != "" {
			msgs = append(msgs, relaychat.TextMsg(role, content))
		}
	}
	prompt := strings.TrimSpace(in.Prompt)
	if prompt != "" || len(in.ImageURLs) > 0 || len(in.Files) > 0 {
		urls := append([]string(nil), in.ImageURLs...)
		for i, imageURL := range urls {
			if s.isSkillTextTemporaryURL(userID, imageURL) {
				loaded, err := s.loadSkillTextTemporaryFile(ctx, userID, imageURL, "image/jpeg")
				if err != nil {
					return GenerateResult{}, err
				}
				urls[i] = loaded
			} else if s.storage != nil {
				urls[i] = s.storage.UpstreamURL(imageURL)
			}
		}
		files := make([]relaychat.FileAttachment, 0, len(in.Files))
		audios := make([]relaychat.AudioAttachment, 0, 1)
		for _, file := range in.Files {
			dataURI := strings.TrimSpace(file.DataURI)
			if dataURI == "" && strings.TrimSpace(file.URL) != "" {
				var err error
				dataURI, err = s.loadSkillTextTemporaryFile(ctx, userID, file.URL, file.MimeType)
				if err != nil {
					return GenerateResult{}, err
				}
			}
			if dataURI == "" {
				continue
			}
			audio, isAudio, audioErr := inputAudioAttachment(dataURI, file.MimeType)
			if audioErr != nil {
				return GenerateResult{}, audioErr
			}
			if isAudio {
				audios = append(audios, audio)
				continue
			}
			files = append(files, relaychat.FileAttachment{Filename: strings.TrimSpace(file.Filename), DataURI: dataURI})
		}
		msgs = append(msgs, relaychat.UserWithMediaAttachments(prompt, urls, files, audios))
	}
	if len(msgs) == 0 {
		return GenerateResult{}, errors.New("text completion prompt is required")
	}

	started := time.Now()
	reply, err := s.relay.ChatWithWebSearch(ctx, modelKey, msgs, in.WebSearch)
	if err == nil {
		reply = strings.TrimSpace(reply)
		if reply == "" {
			err = errors.New("model returned empty response")
		} else if in.StrictJSON {
			reply = stripJSONFence(reply)
			if !json.Valid([]byte(reply)) {
				err = errors.New("model returned invalid JSON")
			}
		} else if !analysisResponseComplete(in.AnalysisKind, reply) {
			err = errors.New("analysis response incomplete")
		}
	}
	reqBody, _ := json.Marshal(msgs)
	eventlog.ModelText(userID, "skill", modelKey, "/v1/chat/completions", eventlog.SanitizeDataURIs(string(reqBody)), reply, started, err, pointCost)
	if err != nil {
		return GenerateResult{}, err
	}
	return GenerateResult{Meta: map[string]any{"text": reply}}, nil
}

func inputAudioAttachment(dataURI, mimeType string) (relaychat.AudioAttachment, bool, error) {
	dataURI = strings.TrimSpace(dataURI)
	mimeType = strings.ToLower(strings.TrimSpace(mimeType))
	lower := strings.ToLower(dataURI)
	isAudio := strings.HasPrefix(mimeType, "audio/") || strings.HasPrefix(lower, "data:audio/")
	if !isAudio {
		return relaychat.AudioAttachment{}, false, nil
	}
	separator := strings.IndexByte(dataURI, ',')
	if separator <= 0 || separator == len(dataURI)-1 {
		return relaychat.AudioAttachment{}, true, errors.New("audio input data is invalid")
	}
	header := strings.ToLower(strings.TrimSpace(dataURI[:separator]))
	format := ""
	switch header {
	case "data:audio/mpeg;base64", "data:audio/mp3;base64":
		format = "mp3"
	case "data:audio/wav;base64", "data:audio/x-wav;base64", "data:audio/wave;base64":
		format = "wav"
	default:
		return relaychat.AudioAttachment{}, true, errors.New("audio input format is unsupported")
	}
	data := strings.TrimSpace(dataURI[separator+1:])
	if _, err := base64.StdEncoding.Strict().DecodeString(data); err != nil {
		return relaychat.AudioAttachment{}, true, errors.New("audio input base64 is invalid")
	}
	return relaychat.AudioAttachment{Data: data, Format: format}, true, nil
}

var analysisTimestampPattern = regexp.MustCompile(`\[(?:\d{1,2}:)?\d{1,3}:\d{2}\]`)

func analysisResponseComplete(kind, value string) bool {
	kind = strings.TrimSpace(kind)
	if kind != "analyze_video" && kind != "analyze_audio" {
		return true
	}
	value = strings.TrimSpace(value)
	minimumRunes := 180
	if kind == "analyze_video" {
		minimumRunes = 240
	}
	if len([]rune(value)) < minimumRunes || !analysisTimestampPattern.MatchString(value) {
		return false
	}
	lower := strings.ToLower(value)
	hasAny := func(values ...string) bool {
		for _, candidate := range values {
			if strings.Contains(lower, strings.ToLower(candidate)) {
				return true
			}
		}
		return false
	}
	if !hasAny("转写", "asr", "transcript") {
		return false
	}
	if kind == "analyze_audio" {
		return hasAny("行动项", "待办", "决定", "action item")
	}
	return hasAny("叙事结构", "结构") && hasAny("镜头节奏", "节奏") && hasAny("改进", "建议", "优化")
}

const maxSkillTextTemporaryFileBytes = 16 << 20

func (s *service) loadSkillTextTemporaryFile(ctx context.Context, userID idgen.ID, rawURL, mimeType string) (string, error) {
	if s.storage == nil {
		return "", errors.New("text attachment storage is not configured")
	}
	canonical, ok := s.storage.OwnsURL(strings.TrimSpace(rawURL))
	if !ok {
		return "", errors.New("text attachment is outside managed storage")
	}
	parsed, err := url.Parse(canonical)
	if err != nil {
		return "", errors.New("text attachment URL is invalid")
	}
	pathValue, _ := url.PathUnescape(parsed.Path)
	if !skillTextTemporaryPathBelongsToUser(pathValue, userID) {
		return "", errors.New("text attachment is not owned by the current tool run user")
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, canonical, nil)
	if err != nil {
		return "", err
	}
	client := &http.Client{Timeout: 2 * time.Minute, CheckRedirect: func(_ *http.Request, _ []*http.Request) error {
		return errors.New("text attachment download does not allow redirects")
	}}
	resp, err := client.Do(req)
	if err != nil {
		return "", fmt.Errorf("read text attachment: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 || resp.ContentLength > maxSkillTextTemporaryFileBytes {
		return "", errors.New("text attachment is unavailable or too large")
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, maxSkillTextTemporaryFileBytes+1))
	if err != nil || len(data) == 0 || len(data) > maxSkillTextTemporaryFileBytes {
		return "", errors.New("text attachment is empty or too large")
	}
	mimeType = strings.ToLower(strings.TrimSpace(mimeType))
	if mimeType != "audio/mpeg" && mimeType != "image/jpeg" {
		return "", errors.New("text attachment MIME type is unsupported")
	}
	return "data:" + mimeType + ";base64," + base64.StdEncoding.EncodeToString(data), nil
}

func skillTextTemporaryPathBelongsToUser(pathValue string, userID idgen.ID) bool {
	clean := path.Clean("/" + strings.TrimPrefix(strings.ReplaceAll(pathValue, "\\", "/"), "/"))
	return strings.Contains(clean, "/generated/tool-analysis/"+userID.String()+"/")
}

func (s *service) isSkillTextTemporaryURL(userID idgen.ID, rawURL string) bool {
	if s.storage == nil {
		return false
	}
	canonical, ok := s.storage.OwnsURL(strings.TrimSpace(rawURL))
	if !ok {
		return false
	}
	parsed, err := url.Parse(canonical)
	if err != nil {
		return false
	}
	pathValue, _ := url.PathUnescape(parsed.Path)
	return skillTextTemporaryPathBelongsToUser(pathValue, userID)
}

func (s *service) cleanupSkillTextTemporaryFiles(userID idgen.ID, keys []string) {
	if s.storage == nil {
		return
	}
	cleanupCtx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	prefix := "generated/tool-analysis/" + userID.String() + "/"
	for _, key := range keys {
		clean := path.Clean(strings.ReplaceAll(strings.TrimSpace(key), "\\", "/"))
		if strings.HasPrefix(clean, prefix) {
			_ = s.storage.Delete(cleanupCtx, clean)
		}
	}
}

func (s *service) cleanupSkillTextTemporaryInput(userID idgen.ID, rawInput string) {
	var input struct {
		TemporaryStorageKeys []string `json:"temporaryStorageKeys"`
	}
	if json.Unmarshal([]byte(rawInput), &input) == nil {
		s.cleanupSkillTextTemporaryFiles(userID, input.TemporaryStorageKeys)
	}
}

func stripJSONFence(s string) string {
	s = strings.TrimSpace(s)
	if strings.HasPrefix(s, "```") {
		if i := strings.IndexByte(s, '\n'); i >= 0 {
			s = s[i+1:]
		}
		if i := strings.LastIndex(s, "```"); i >= 0 {
			s = s[:i]
		}
	}
	return strings.TrimSpace(s)
}
