package ai

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strings"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
	"tidecanvas/internal/middleware"
	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/idgen"
	"tidecanvas/internal/pkg/response"
)

// The browser submits owned upload IDs, never prompt text, provider parameters,
// references belonging to another user, or the preview displayed in the catalogue.
type templateUploads struct {
	ImageIDs []idgen.ID `json:"imageIds"`
	VideoIDs []idgen.ID `json:"videoIds"`
	AudioIDs []idgen.ID `json:"audioIds"`
}

type templateQuoteVO struct {
	TemplateID         idgen.ID                    `json:"templateId"`
	ModelID            string                      `json:"modelId"`
	ModelName          string                      `json:"modelName"`
	Handler            string                      `json:"handler"`
	PointCost          int                         `json:"pointCost"`
	QuoteToken         string                      `json:"quoteToken"`
	Options            model.StudioTemplateOptions `json:"options"`
	BasePointCost      int                         `json:"basePointCost"`
	ReferencePointCost int                         `json:"referencePointCost"`
}

type templateSetupVO struct {
	ModelID               string                      `json:"modelId"`
	ModelName             string                      `json:"modelName"`
	Handler               string                      `json:"handler"`
	BasePointCost         int                         `json:"basePointCost"`
	ReferenceVideoBilling bool                        `json:"referenceVideoBilling"`
	Options               model.StudioTemplateOptions `json:"options"`
	MaxUploadBytes        map[string]int64            `json:"maxUploadBytes"`
}

func templateError(message string) error { return skillPlacementError{message: message} }

func (s *service) prepareTemplateGeneration(ctx context.Context, uid idgen.ID, dto *generateDTO) error {
	return s.prepareTemplateRecipe(ctx, uid, dto, false)
}

// Setup resolves the same recipe without submitting, accepting files, or minting
// an executable quote. The boolean is internal-only, never accepted from HTTP.
func (s *service) prepareTemplateRecipe(ctx context.Context, uid idgen.ID, dto *generateDTO, setupOnly bool) error {
	var row model.StudioTemplate
	if err := s.repo.db.WithContext(ctx).Where("id = ? AND status = 1", dto.TemplateID).First(&row).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return templateError("模板已下架或不存在，请选择其他模板")
		}
		return err
	}
	return s.prepareTemplateRow(ctx, uid, dto, row, setupOnly)
}

func (s *service) prepareTemplateRow(ctx context.Context, uid idgen.ID, dto *generateDTO, row model.StudioTemplate, setupOnly bool) error {
	handler := map[string]string{"t2i": "text_to_image", "i2i": "image_to_image", "t2v": "text_to_video", "i2v": "image_to_video", "flf": "start_end_to_video", "ref": "reference_to_video"}[row.Mode]
	if handler == "" || strings.TrimSpace(row.Prompt) == "" || (row.MediaType != "image" && row.MediaType != "video") {
		return templateError("模板配置不完整，请联系管理员")
	}
	var uploads templateUploads
	decoder := json.NewDecoder(bytes.NewReader(dto.Input))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&uploads); err != nil || decoder.Decode(new(any)) != io.EOF {
		return templateError("模板仅接受上传素材，请刷新页面后重试")
	}
	req := row.Requirements
	if req.Images < 0 || req.Videos < 0 || req.Audio < 0 || req.Images > 16 || req.Videos > 15 || req.Audio > 15 {
		return templateError("模板素材要求无效，请联系管理员")
	}
	if row.Mode == "i2i" || row.Mode == "i2v" {
		req.Images = max(1, req.Images)
	}
	if row.Mode == "flf" {
		req.Images = 2
	}
	flexible := row.Mode == "ref" && req.Images+req.Videos+req.Audio == 0
	if !setupOnly && flexible {
		if len(uploads.ImageIDs)+len(uploads.VideoIDs)+len(uploads.AudioIDs) == 0 {
			return templateError("请上传至少一个参考素材")
		}
	} else if !setupOnly && (len(uploads.ImageIDs) != req.Images || len(uploads.VideoIDs) != req.Videos || len(uploads.AudioIDs) != req.Audio) {
		return templateError(fmt.Sprintf("请按模板要求上传 %d 张图片、%d 段视频、%d 段音频", req.Images, req.Videos, req.Audio))
	}
	if len(uploads.ImageIDs) > 16 || len(uploads.VideoIDs) > 15 || len(uploads.AudioIDs) > 15 {
		return templateError("上传素材数量过多")
	}
	input := map[string]any{"prompt": row.Prompt, "batchCount": 1}
	ownedFiles := make([]model.File, 0)
	for _, group := range []struct {
		ids       []idgen.ID
		kind, key string
	}{
		{uploads.ImageIDs, "image", "imageUrls"}, {uploads.VideoIDs, "video", "videoReferences"}, {uploads.AudioIDs, "audio", "audioReferences"},
	} {
		urls := make([]string, 0, len(group.ids))
		seenImages := map[string]bool{}
		for _, id := range group.ids {
			var file model.File
			if id == 0 {
				return templateError("素材不存在，请重新上传")
			}
			if err := s.repo.db.WithContext(ctx).Where("id = ? AND owner_id = ?", id, uid).First(&file).Error; err != nil {
				if errors.Is(err, gorm.ErrRecordNotFound) {
					return templateError("素材不存在或不属于当前账号，请重新上传")
				}
				return err
			}
			kind := file.FileType
			if kind == "other" && strings.HasPrefix(strings.ToLower(file.MimeType), "audio/") {
				kind = "audio"
			}
			if kind != group.kind || strings.TrimSpace(file.FileUrl) == "" {
				return templateError("素材类型与模板要求不一致，请重新上传")
			}
			if group.kind == "image" && row.Mode != "flf" {
				url := strings.TrimSpace(file.FileUrl)
				if seenImages[url] {
					return templateError("不同图片位置上传了同一份素材，请按各位置的用途选择不同图片")
				}
				seenImages[url] = true
			}
			urls = append(urls, file.FileUrl)
			ownedFiles = append(ownedFiles, file)
		}
		if len(urls) > 0 {
			input[group.key] = urls
			if row.Mode == "flf" && group.kind == "image" && len(urls) == 2 {
				// Discrete frame fields preserve a deliberate same-image loop.
				// The generic image-list reader deduplicates URLs.
				input["firstFrame"], input["lastFrame"] = urls[0], urls[1]
			}
		}
	}
	models, err := s.repo.listEnabledModels(ctx)
	if err != nil {
		return err
	}
	var selected *model.AiModel
	for i := range models {
		m := &models[i]
		// A quoted model is pinned for the submit, even if catalogue popularity changes.
		key := strings.TrimSpace(row.ModelKey)
		if key == "" {
			key = strings.TrimSpace(dto.ModelID)
		}
		if key != "" && m.ModelID != key && m.ID.String() != key {
			continue
		}
		if m.ModelID == "" || m.Type != row.MediaType || !modelSupportsHandler(m, handler) || validateModelAvailability(m) != nil {
			continue
		}
		var cfg map[string]any
		_ = json.Unmarshal([]byte(m.Config), &cfg)
		mode := row.Mode
		if mode == "flf" {
			mode = "keyframe"
		}
		if mode == "ref" {
			mode = "omni_ref"
		}
		if modes := inputStrings(cfg, "modes"); len(modes) > 0 {
			found := false
			for _, v := range modes {
				if v == mode {
					found = true
				}
			}
			if !found {
				continue
			}
		}
		candidate := *dto
		candidate.Handler = handler
		candidate.Input, _ = json.Marshal(input)
		if validateOmniReferenceInput(&candidate, m) != nil || validateReferenceCountInput(&candidate, m) != nil {
			continue
		}
		imageCount := len(uploads.ImageIDs)
		if setupOnly {
			imageCount = req.Images
			if row.Mode == "ref" {
				support := modelOmniReferenceSupport(m)
				if (req.Images > 0 && !support.image) || (req.Videos > 0 && !support.video) || (req.Audio > 0 && !support.audio) {
					continue
				}
				compatible := true
				for kind, count := range map[string]int{"image": req.Images, "video": req.Videos, "audio": req.Audio} {
					if max := modelOmniReferenceCountLimit(m, kind); max > 0 && count > max {
						compatible = false
					}
				}
				if !compatible {
					continue
				}
			}
		}
		if row.Mode == "i2i" {
			if limit := inputInt(cfg, "maxRefImages"); limit > 0 && imageCount > limit {
				continue
			}
		}
		if setupOnly && flexible {
			support := modelOmniReferenceSupport(m)
			if !support.image || !support.video || !support.audio {
				// The flexible workshop offers all three media kinds. Its initial
				// setup must not choose a model that rejects one of those slots.
				continue
			}
		}
		selected = m
		break
	}
	if selected == nil {
		return templateError("此模板暂时没有可用模型，请稍后重试或选择其他模板")
	}
	var cfg map[string]any
	_ = json.Unmarshal([]byte(selected.Config), &cfg)
	for _, file := range ownedFiles {
		kind := file.FileType
		if kind == "other" && strings.HasPrefix(strings.ToLower(file.MimeType), "audio/") {
			kind = "audio"
		}
		limit := templateUploadLimit(cfg, row.Mode, kind)
		if file.FileSize > limit {
			return templateError(fmt.Sprintf("模板所用模型要求单个%s不超过 %g MB，请压缩后重新上传", map[string]string{"image": "图片", "video": "视频", "audio": "音频"}[kind], float64(limit)/(1024*1024)))
		}
	}
	pick := func(value, key string) (string, error) {
		options := inputStrings(cfg, key)
		for _, option := range options {
			if strings.EqualFold(strings.TrimSpace(value), strings.TrimSpace(option)) {
				return option, nil
			}
		}
		if len(options) > 0 {
			if strings.TrimSpace(value) != "" {
				return "", templateError(fmt.Sprintf("模型不再支持模板的%s「%s」，请联系管理员重新配置", map[string]string{"ratios": "画面比例", "resolutions": "分辨率", "qualities": "质量"}[key], value))
			}
			return options[0], nil
		}
		return "", nil
	}
	for _, spec := range []struct{ field, config, value string }{
		{"aspectRatio", "ratios", row.Options.AspectRatio},
		{"resolution", "resolutions", row.Options.Resolution},
	} {
		value, err := pick(spec.value, spec.config)
		if err != nil {
			return err
		}
		if value != "" {
			input[spec.field] = value
		}
	}
	if row.MediaType == "image" {
		value, err := pick(row.Options.Quality, "qualities")
		if err != nil {
			return err
		}
		if value != "" {
			input["quality"] = value
		}
		count := row.Options.BatchCount
		minCount, maxCount := templateBatchRange(cfg)
		if count == 0 {
			count = minCount
		}
		if count < minCount || count > maxCount {
			return templateError(fmt.Sprintf("模板生成数量不受模型支持，请在后台选择 %d～%d 张", minCount, maxCount))
		}
		input["batchCount"] = count
	}
	if row.MediaType == "video" {
		duration := row.Options.Duration
		options := configDurationValues(cfg["durations"])
		if len(options) > 0 {
			found := false
			for _, value := range options {
				n := durationSeconds(value)
				if n == duration {
					found = true
				}
			}
			if !found {
				if duration > 0 {
					return templateError(fmt.Sprintf("模型不再支持模板的 %g 秒视频，请联系管理员重新配置", duration))
				}
				duration = durationSeconds(options[0])
			}
			if duration <= 0 || duration > 600 {
				return templateError("模板模型的视频时长配置无效")
			}
			input["duration"] = duration
		}
	}
	dto.Handler = handler
	dto.ModelID = selected.ModelID
	dto.Origin = "template"
	dto.templateSnapshot = &row
	dto.Input, _ = json.Marshal(input)
	public := decodeInput(dto.Input)
	delete(public, "prompt")
	public["templateId"] = row.ID.String()
	public["templateTitle"] = row.Title
	dto.PublicInput, _ = json.Marshal(public)
	if err := validateGenerationPromptSize(input); err != nil {
		return templateError("模板内容过长，请联系管理员调整")
	}
	if err := validateModelPromptCharLimit(dto, selected); err != nil {
		return templateError("模板内容超过模型限制，请联系管理员")
	}
	if err := validateRequiredReferenceInput(dto); !setupOnly && err != nil {
		return err
	}
	return nil
}

func templateBatchRange(cfg map[string]any) (int, int) {
	if hidden, _ := cfg["hideBatchCount"].(bool); hidden {
		return 1, 1
	}
	low, high := 5, 0
	if values, ok := cfg["batchOptions"].([]any); ok {
		for _, value := range values {
			n, ok := value.(float64)
			if ok && n >= 1 && n <= 4 && n == float64(int(n)) {
				low = min(low, int(n))
				high = max(high, int(n))
			}
		}
	}
	if high == 0 {
		return 1, 4
	}
	return low, high
}

func templateUploadLimit(cfg map[string]any, mode, kind string) int64 {
	limits, _ := cfg["refLimits"].(map[string]any)
	limit := float64(50)
	var configured float64
	switch mode {
	case "i2i":
		configured = numField(cfg, "maxRefImageSizeMB")
	case "i2v":
		configured = numField(limits, "i2v.imageSizeMB")
	case "flf":
		configured = numField(limits, "keyframe.imageSizeMB")
	case "ref":
		configured = numField(limits, "omniRef."+kind+"SizeMB")
	}
	if configured > 0 && configured < limit {
		limit = configured
	}
	return int64(limit * 1024 * 1024)
}

func templateOutputOptions(dto generateDTO) model.StudioTemplateOptions {
	input := decodeInput(dto.Input)
	count := 0
	if dto.templateSnapshot != nil && dto.templateSnapshot.MediaType == "image" {
		count = inputInt(input, "batchCount")
	}
	return model.StudioTemplateOptions{AspectRatio: inputStr(input, "aspectRatio"), Resolution: inputStr(input, "resolution"), Quality: inputStr(input, "quality"), Duration: durationSeconds(input["duration"]), BatchCount: count}
}

func (h *handler) templateSetup(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	id, err := idgen.Parse(c.Param("id"))
	if err != nil || id == 0 {
		response.Fail(c, 400, "模板编号无效")
		return
	}
	dto := generateDTO{TemplateID: id, Input: json.RawMessage(`{}`)}
	if err := h.svc.prepareTemplateRecipe(c.Request.Context(), 0, &dto, true); err != nil {
		h.templateQuoteError(c, err)
		return
	}
	setup, err := h.svc.templateSetupResult(c.Request.Context(), &dto)
	if err != nil {
		h.templateQuoteError(c, err)
		return
	}
	response.OK(c, setup)
}

func (s *service) templateSetupResult(ctx context.Context, dto *generateDTO) (templateSetupVO, error) {
	m, err := s.repo.findModel(ctx, dto.ModelID)
	if err != nil || m == nil {
		return templateSetupVO{}, templateError("模板模型暂不可用")
	}
	if configured, valid := prepareVideoPerRequestPricingInput(dto, m); configured && !valid {
		return templateSetupVO{}, templateError("模板输出规格尚未配置价格")
	}
	if _, configured, allowed := modelVideoDurationAllowed(m, dto.Handler, dto.Input); configured && !allowed {
		return templateSetupVO{}, templateError("模板视频时长不受模型支持")
	}
	var cfg map[string]any
	_ = json.Unmarshal([]byte(m.Config), &cfg)
	limits := map[string]int64{}
	for _, kind := range []string{"image", "video", "audio"} {
		limits[kind] = templateUploadLimit(cfg, dto.templateSnapshot.Mode, kind)
	}
	return templateSetupVO{ModelID: m.ModelID, ModelName: m.Name, Handler: dto.Handler, BasePointCost: resolveCost(m, dto.Input), ReferenceVideoBilling: referenceVideoPricing(m) && dto.Handler == "reference_to_video", Options: templateOutputOptions(*dto), MaxUploadBytes: limits}, nil
}

// CheckStudioTemplate runs the runtime's model/spec/price checks on an unsaved
// operator recipe. It never creates tasks, debits points or calls a provider.
// Explicit unsupported output settings are rejected instead of silently changing
// the effect an operator intends to publish. Empty settings adopt model defaults.
func CheckStudioTemplate(ctx context.Context, db *gorm.DB, row model.StudioTemplate) (templateSetupVO, error) {
	s := &service{repo: newRepo(db)}
	dto := generateDTO{Input: json.RawMessage(`{}`)}
	if err := s.prepareTemplateRow(ctx, 0, &dto, row, true); err != nil {
		return templateSetupVO{}, err
	}
	setup, err := s.templateSetupResult(ctx, &dto)
	if err != nil {
		return setup, err
	}
	for _, spec := range []struct{ label, requested, resolved string }{
		{"画面比例", row.Options.AspectRatio, setup.Options.AspectRatio},
		{"分辨率", row.Options.Resolution, setup.Options.Resolution},
		{"质量", row.Options.Quality, setup.Options.Quality},
	} {
		if strings.TrimSpace(spec.requested) != "" && !strings.EqualFold(strings.TrimSpace(spec.requested), spec.resolved) {
			return setup, templateError(fmt.Sprintf("模型不支持所填%s「%s」，请改为支持的值（默认 %s）或留空", spec.label, spec.requested, spec.resolved))
		}
	}
	if row.MediaType == "video" && row.Options.Duration > 0 && row.Options.Duration != setup.Options.Duration {
		return setup, templateError(fmt.Sprintf("模型不支持 %g 秒，请选择支持的时长（默认 %g 秒）或留空", row.Options.Duration, setup.Options.Duration))
	}
	return setup, nil
}

// This digest is a change detector, not a client-supplied price authorization.
// Both quote and submit recompute model, owned inputs and price on the server.
func templateQuoteToken(uid idgen.ID, dto generateDTO, m *model.AiModel, cost int) string {
	// Usage counters do not change the recipe or invalidate another user's quote.
	row := *dto.templateSnapshot
	row.Uses = 0
	raw, _ := json.Marshal(struct {
		User     idgen.ID
		Template model.StudioTemplate
		Model    idgen.ID
		Config   string
		Input    json.RawMessage
		Cost     int
	}{uid, row, m.ID, m.Config, dto.Input, cost})
	digest := sha256.Sum256(raw)
	return hex.EncodeToString(digest[:])
}

func (h *handler) templateQuote(c *gin.Context) {
	var dto generateDTO
	if c.ShouldBindJSON(&dto) != nil || dto.TemplateID == 0 {
		response.Fail(c, 400, "请选择模板并上传所需素材")
		return
	}
	uid := middleware.CurrentUserID(c)
	if err := h.svc.prepareTemplateGeneration(c.Request.Context(), uid, &dto); err != nil {
		h.templateQuoteError(c, err)
		return
	}
	m, err := h.svc.repo.findModel(c.Request.Context(), dto.ModelID)
	if err != nil || m == nil {
		response.Fail(c, 400, "模板模型暂不可用")
		return
	}
	if configured, valid := prepareVideoPerRequestPricingInput(&dto, m); configured && !valid {
		response.Fail(c, 400, "模板输出规格尚未配置价格，请联系管理员")
		return
	}
	extra, err := h.svc.prepareReferenceVideoPricingInput(c.Request.Context(), uid, &dto, m)
	if err != nil {
		h.templateQuoteError(c, err)
		return
	}
	if _, configured, allowed := modelVideoDurationAllowed(m, dto.Handler, dto.Input); configured && !allowed {
		response.Fail(c, 400, "模板视频时长不受模型支持")
		return
	}
	cost, err := combineGenerationPointCost(resolveCost(m, dto.Input), extra)
	if err != nil {
		h.templateQuoteError(c, err)
		return
	}
	response.OK(c, templateQuoteVO{TemplateID: dto.TemplateID, ModelID: dto.ModelID, ModelName: m.Name, Handler: dto.Handler, PointCost: cost, QuoteToken: templateQuoteToken(uid, dto, m, cost), Options: templateOutputOptions(dto), BasePointCost: resolveCost(m, dto.Input), ReferencePointCost: extra})
}

func (h *handler) templateQuoteError(c *gin.Context, err error) {
	var placement skillPlacementError
	if errors.As(err, &placement) {
		response.Fail(c, 400, placement.Error())
		return
	}
	response.Fail(c, 500, "暂时无法确认模板积分，请稍后重试")
}
