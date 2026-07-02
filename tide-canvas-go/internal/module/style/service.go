package style

import (
	"encoding/json"
	"strings"

	"github.com/sirupsen/logrus"
	"gorm.io/datatypes"

	"github.com/tidecanvas/tide-canvas-go/internal/model"
	"github.com/tidecanvas/tide-canvas-go/pkg/ecode"
)

// Service 负责风格库业务校验、访问控制和 DTO 转换。
type Service struct {
	repo   *Repository
	logger *logrus.Logger
}

// NewService 创建风格库服务。
func NewService(repo *Repository, logger *logrus.Logger) *Service {
	return &Service{repo: repo, logger: logger}
}

// ListUserPresets 查询用户端风格库。
func (s *Service) ListUserPresets(userID int64, q *PresetQuery) ([]PresetVO, int64, error) {
	q.normalize()
	records, total, err := s.repo.PagePresets(userID, q, false)
	if err != nil {
		return nil, 0, err
	}
	vos, err := s.toVOs(userID, records)
	return vos, total, err
}

// ListAdminPresets 查询后台风格库。
func (s *Service) ListAdminPresets(q *PresetQuery) ([]PresetVO, int64, error) {
	q.normalize()
	records, total, err := s.repo.PagePresets(0, q, true)
	if err != nil {
		return nil, 0, err
	}
	vos, err := s.toVOs(0, records)
	return vos, total, err
}

// CreateCustom 创建用户自定义风格，默认只归本人可见。
func (s *Service) CreateCustom(userID int64, dto *PresetSaveDTO) (*PresetVO, error) {
	preset, err := s.buildPreset(dto)
	if err != nil {
		return nil, err
	}
	preset.OwnerUserID = &userID
	preset.Official = 0
	if dto.PublicFlag == nil {
		preset.PublicFlag = 0
	}
	if preset.AuthorName == "" {
		preset.AuthorName = "我"
	}
	if err := s.repo.CreatePreset(preset); err != nil {
		return nil, err
	}
	return s.toVO(userID, preset, false), nil
}

// CreateAdmin 创建后台官方/公共风格。
func (s *Service) CreateAdmin(dto *PresetSaveDTO) (*PresetVO, error) {
	preset, err := s.buildPreset(dto)
	if err != nil {
		return nil, err
	}
	if dto.Official == nil {
		preset.Official = 1
	}
	if dto.PublicFlag == nil {
		preset.PublicFlag = 1
	}
	if err := s.repo.CreatePreset(preset); err != nil {
		return nil, err
	}
	return s.toVO(0, preset, false), nil
}

// UpdateAdmin 更新后台风格。
func (s *Service) UpdateAdmin(publicID string, dto *PresetSaveDTO) error {
	preset, err := s.repo.FindByPublicID(publicID)
	if err != nil {
		return err
	}
	if preset == nil {
		return ecode.NotFound
	}
	if strings.TrimSpace(dto.Name) == "" || strings.TrimSpace(dto.Prompt) == "" {
		return ecode.BadRequest.WithMessage("风格名称和提示词不能为空")
	}
	columns, err := saveColumns(dto)
	if err != nil {
		return err
	}
	return s.repo.UpdatePresetColumns(preset.ID, columns)
}

// DeleteAdmin 删除后台风格。
func (s *Service) DeleteAdmin(publicID string) error {
	preset, err := s.repo.FindByPublicID(publicID)
	if err != nil {
		return err
	}
	if preset == nil {
		return ecode.NotFound
	}
	return s.repo.DeletePreset(preset.ID)
}

// ToggleFavorite 切换用户收藏。
func (s *Service) ToggleFavorite(userID int64, publicID string) (bool, error) {
	preset, err := s.requireVisible(userID, publicID)
	if err != nil {
		return false, err
	}
	return s.repo.ToggleFavorite(userID, preset.ID)
}

// RecordUse 记录用户最近使用。
func (s *Service) RecordUse(userID int64, publicID string) error {
	preset, err := s.requireVisible(userID, publicID)
	if err != nil {
		return err
	}
	return s.repo.RecordUse(userID, preset.ID)
}

func (s *Service) requireVisible(userID int64, publicID string) (*model.StylePreset, error) {
	preset, err := s.repo.FindByPublicID(publicID)
	if err != nil {
		return nil, err
	}
	if preset == nil || preset.Status != 1 {
		return nil, ecode.NotFound
	}
	if preset.PublicFlag == 1 {
		return preset, nil
	}
	if preset.OwnerUserID != nil && *preset.OwnerUserID == userID {
		return preset, nil
	}
	return nil, ecode.NotFound
}

func (s *Service) buildPreset(dto *PresetSaveDTO) (*model.StylePreset, error) {
	if strings.TrimSpace(dto.Name) == "" || strings.TrimSpace(dto.Prompt) == "" {
		return nil, ecode.BadRequest.WithMessage("风格名称和提示词不能为空")
	}
	tags, err := encodeTags(dto.Tags)
	if err != nil {
		return nil, err
	}
	modelIDs := normalizeModelIDs(dto.ModelIDs, dto.ModelID)
	modelIDsJSON, err := encodeStringList(modelIDs)
	if err != nil {
		return nil, err
	}
	modelPrompts, err := encodePromptMap(dto.ModelPrompts, modelIDs)
	if err != nil {
		return nil, err
	}
	preset := &model.StylePreset{
		Name:         strings.TrimSpace(dto.Name),
		ShortName:    trimOrDefault(dto.ShortName, dto.Name),
		Description:  strings.TrimSpace(dto.Description),
		Prompt:       strings.TrimSpace(dto.Prompt),
		CoverURL:     strings.TrimSpace(dto.CoverURL),
		Category:     trimOrDefault(dto.Category, "推荐"),
		AuthorName:   trimOrDefault(dto.AuthorName, "TideCanvas"),
		ModelType:    trimOrDefault(dto.ModelType, "image"),
		ModelID:      legacyModelID(dto.ModelID, modelIDs),
		ModelIDs:     modelIDsJSON,
		ModelPrompts: modelPrompts,
		Tags:         tags,
		Commercial:   intValue(dto.Commercial, 1),
		PublicFlag:   intValue(dto.PublicFlag, 1),
		Official:     intValue(dto.Official, 0),
		Status:       intValue(dto.Status, 1),
		SortOrder:    intValue(dto.SortOrder, 0),
	}
	return preset, nil
}

func saveColumns(dto *PresetSaveDTO) (map[string]interface{}, error) {
	tags, err := encodeTags(dto.Tags)
	if err != nil {
		return nil, err
	}
	modelIDs := normalizeModelIDs(dto.ModelIDs, dto.ModelID)
	modelIDsJSON, err := encodeStringList(modelIDs)
	if err != nil {
		return nil, err
	}
	modelPrompts, err := encodePromptMap(dto.ModelPrompts, modelIDs)
	if err != nil {
		return nil, err
	}
	return map[string]interface{}{
		"name":          strings.TrimSpace(dto.Name),
		"short_name":    trimOrDefault(dto.ShortName, dto.Name),
		"description":   strings.TrimSpace(dto.Description),
		"prompt":        strings.TrimSpace(dto.Prompt),
		"cover_url":     strings.TrimSpace(dto.CoverURL),
		"category":      trimOrDefault(dto.Category, "推荐"),
		"author_name":   trimOrDefault(dto.AuthorName, "TideCanvas"),
		"model_type":    trimOrDefault(dto.ModelType, "image"),
		"model_id":      legacyModelID(dto.ModelID, modelIDs),
		"model_ids":     modelIDsJSON,
		"model_prompts": modelPrompts,
		"tags":          tags,
		"commercial":    intValue(dto.Commercial, 1),
		"public_flag":   intValue(dto.PublicFlag, 1),
		"official":      intValue(dto.Official, 0),
		"status":        intValue(dto.Status, 1),
		"sort_order":    intValue(dto.SortOrder, 0),
	}, nil
}

func (s *Service) toVOs(userID int64, records []model.StylePreset) ([]PresetVO, error) {
	ids := make([]int64, 0, len(records))
	for i := range records {
		ids = append(ids, records[i].ID)
	}
	favs, err := s.repo.FavoriteMap(userID, ids)
	if err != nil {
		return nil, err
	}
	out := make([]PresetVO, 0, len(records))
	for i := range records {
		out = append(out, *s.toVO(userID, &records[i], favs[records[i].ID]))
	}
	return out, nil
}

func (s *Service) toVO(userID int64, p *model.StylePreset, favorited bool) *PresetVO {
	ownerType := "system"
	if p.OwnerUserID != nil {
		ownerType = "user"
	}
	return &PresetVO{
		ID:           p.PublicID,
		Name:         p.Name,
		ShortName:    p.ShortName,
		Description:  p.Description,
		Prompt:       p.Prompt,
		CoverURL:     p.CoverURL,
		Category:     p.Category,
		AuthorName:   p.AuthorName,
		ModelType:    p.ModelType,
		ModelID:      p.ModelID,
		ModelIDs:     decodeStringList(p.ModelIDs),
		ModelPrompts: decodePromptMap(p.ModelPrompts),
		Tags:         decodeTags(p.Tags),
		Commercial:   p.Commercial,
		PublicFlag:   p.PublicFlag,
		Official:     p.Official,
		Status:       p.Status,
		SortOrder:    p.SortOrder,
		UsageCount:   p.UsageCount,
		Favorited:    userID > 0 && favorited,
		OwnerType:    ownerType,
		CreateTime:   p.CreateTime,
		UpdateTime:   p.UpdateTime,
	}
}

func normalizeModelIDs(ids []string, legacy string) []string {
	seen := make(map[string]bool, len(ids)+1)
	out := make([]string, 0, len(ids)+1)
	for _, id := range ids {
		id = strings.TrimSpace(id)
		if id == "" || seen[id] {
			continue
		}
		seen[id] = true
		out = append(out, id)
	}
	legacy = strings.TrimSpace(legacy)
	if len(out) == 0 && legacy != "" {
		out = append(out, legacy)
	}
	return out
}

func legacyModelID(value string, modelIDs []string) string {
	value = strings.TrimSpace(value)
	if value != "" {
		return value
	}
	if len(modelIDs) == 1 {
		return modelIDs[0]
	}
	return ""
}

func encodeStringList(values []string) (datatypes.JSON, error) {
	cleaned := make([]string, 0, len(values))
	seen := make(map[string]bool, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" || seen[value] {
			continue
		}
		seen[value] = true
		cleaned = append(cleaned, value)
	}
	if len(cleaned) == 0 {
		return datatypes.JSON("[]"), nil
	}
	raw, err := json.Marshal(cleaned)
	if err != nil {
		return nil, ecode.BadRequest.WithMessage("invalid list format")
	}
	return datatypes.JSON(raw), nil
}

func decodeStringList(raw datatypes.JSON) []string {
	if len(raw) == 0 {
		return []string{}
	}
	var values []string
	if err := json.Unmarshal(raw, &values); err != nil {
		return []string{}
	}
	out := make([]string, 0, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value != "" {
			out = append(out, value)
		}
	}
	return out
}

func encodePromptMap(prompts map[string]string, modelIDs []string) (datatypes.JSON, error) {
	allowed := make(map[string]bool, len(modelIDs))
	for _, id := range modelIDs {
		id = strings.TrimSpace(id)
		if id != "" {
			allowed[id] = true
		}
	}
	cleaned := make(map[string]string, len(prompts))
	for id, prompt := range prompts {
		id = strings.TrimSpace(id)
		prompt = strings.TrimSpace(prompt)
		if id == "" || prompt == "" {
			continue
		}
		if len(allowed) > 0 && !allowed[id] {
			continue
		}
		cleaned[id] = prompt
	}
	if len(cleaned) == 0 {
		return datatypes.JSON("{}"), nil
	}
	raw, err := json.Marshal(cleaned)
	if err != nil {
		return nil, ecode.BadRequest.WithMessage("invalid model prompt format")
	}
	return datatypes.JSON(raw), nil
}

func decodePromptMap(raw datatypes.JSON) map[string]string {
	out := map[string]string{}
	if len(raw) == 0 {
		return out
	}
	var values map[string]string
	if err := json.Unmarshal(raw, &values); err != nil {
		return out
	}
	for id, prompt := range values {
		id = strings.TrimSpace(id)
		prompt = strings.TrimSpace(prompt)
		if id != "" && prompt != "" {
			out[id] = prompt
		}
	}
	return out
}

func encodeTags(tags []string) (datatypes.JSON, error) {
	return encodeStringList(tags)
}
func decodeTags(raw datatypes.JSON) []string {
	if len(raw) == 0 {
		return []string{}
	}
	var tags []string
	if err := json.Unmarshal(raw, &tags); err != nil {
		return []string{}
	}
	return tags
}

func intValue(v *int, fallback int) int {
	if v == nil {
		return fallback
	}
	return *v
}

func trimOrDefault(v, fallback string) string {
	if strings.TrimSpace(v) != "" {
		return strings.TrimSpace(v)
	}
	return strings.TrimSpace(fallback)
}

// SeedDefaults 初始化官方风格，空表时才写入。
func (s *Service) SeedDefaults() {
	total, err := s.repo.CountOfficialSeeds()
	if err != nil {
		if s.logger != nil {
			s.logger.Warnf("[style] 风格种子检查失败: %v", err)
		}
		return
	}
	if total > 0 {
		return
	}
	seeds := []model.StylePreset{
		seedPreset("00000000-0000-4000-8000-000000000101", 910001, "电影质感", "电影", "低饱和电影光影、真实镜头语言、细腻景深和高级调色", "cinematic lighting, subtle film grain, realistic camera language, shallow depth of field, premium color grading", "推荐", 980),
		seedPreset("00000000-0000-4000-8000-000000000102", 910002, "电商详情页", "电商", "适合商品主图、详情页海报和卖点展示，画面干净有销售感", "clean commercial product poster, e-commerce detail page layout, premium product lighting, clear selling points, studio quality", "电商营销", 960),
		seedPreset("00000000-0000-4000-8000-000000000103", 910003, "CCD 复古", "CCD", "复古数码相机颗粒、闪光灯、轻微过曝和真实生活抓拍感", "retro CCD camera look, direct flash, slight overexposure, authentic snapshot feeling, nostalgic color cast", "摄影写真", 940),
		seedPreset("00000000-0000-4000-8000-000000000104", 910004, "二次元清新", "二次元", "清透动漫插画风，色彩柔和、人物精致、背景轻盈", "fresh anime illustration, soft pastel colors, delicate character design, clean background, polished line art", "动漫游戏", 920),
		seedPreset("00000000-0000-4000-8000-000000000105", 910005, "建筑室内写实", "室内", "建筑与室内空间写实渲染，真实材质、自然采光和高级空间构图", "photorealistic architecture and interior rendering, natural daylight, realistic materials, refined spatial composition", "建筑及室内设计", 900),
		seedPreset("00000000-0000-4000-8000-000000000106", 910006, "平面设计海报", "海报", "强版式设计、明确层级、适合品牌视觉和营销活动海报", "graphic design poster, strong typography hierarchy, clean visual layout, brand campaign style, high-end editorial composition", "平面设计", 880),
	}
	for i := range seeds {
		if err := s.repo.CreatePreset(&seeds[i]); err != nil && s.logger != nil {
			s.logger.Warnf("[style] 初始化风格失败: %s, %v", seeds[i].Name, err)
		}
	}
}

func seedPreset(publicID string, id int64, name, short, description, prompt, category string, sort int) model.StylePreset {
	return model.StylePreset{
		PublicModel: model.PublicModel{ID: id, PublicID: publicID},
		Name:        name,
		ShortName:   short,
		Description: description,
		Prompt:      prompt,
		Category:    category,
		AuthorName:  "TideCanvas",
		ModelType:   "image",
		Tags:        datatypes.JSON("[]"),
		Commercial:  1,
		PublicFlag:  1,
		Official:    1,
		Status:      1,
		SortOrder:   sort,
	}
}
