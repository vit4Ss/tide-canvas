package ai

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"strings"
	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/idgen"
	"time"
)

// Called after reserveGenerationSlot has locked the wallet, and before debit.
// Lock order is user -> batch -> template. A stop acknowledgement cannot race
// with a later charge; a committed task can still be recovered after stopping.
func validateTemplateCoverBatchTx(tx *gorm.DB, uid idgen.ID, dto generateDTO, cost int, requestHash string) error {
	if dto.TemplateCoverBatchID == 0 {
		return nil
	}
	reject := func(message string) error { return skillPlacementError{message: message} }
	var owner model.User
	if err := tx.Select("id", "status").First(&owner, "id = ?", uid).Error; err != nil {
		return err
	}
	if owner.Status != 1 {
		return reject("当前账号不可用，已停止新的封面任务")
	}
	var batch model.TemplateCoverBatch
	if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&batch, "id = ? AND user_id = ?", dto.TemplateCoverBatchID, uid).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return reject("批量任务已不存在或不属于当前账号")
		}
		return err
	}
	if batch.ActiveKey == nil || batch.Status != "running" || batch.StopRequested {
		return reject("批量任务已停止，不再提交新的图片")
	}
	if dto.TemplateCoverWorker == "" || batch.Worker != dto.TemplateCoverWorker || batch.LeaseUntil == nil || !batch.LeaseUntil.After(time.Now()) {
		return reject("批量任务执行权已失效，请等待恢复")
	}
	if dto.Handler != "text_to_image" || batch.ModelID != dto.ModelID || batch.ModelHash != dto.TemplateCoverModelHash || batch.UnitCost != cost {
		return reject("批次模型或价格已变化")
	}
	for _, item := range batch.Items {
		if item.TemplateID != dto.TemplateCoverTemplateID {
			continue
		}
		if item.Status != "pending" || item.TaskID != 0 || dto.ClientRequestID != fmt.Sprintf("template-cover:%s:%s", batch.ID, item.TemplateID) {
			return reject("该封面任务不在待执行队列中")
		}
		expected := dto
		expected.Input, _ = json.Marshal(item.Input)
		expectedHash, err := directGenerationFingerprint(expected)
		if err != nil || expectedHash != requestHash {
			return reject("封面请求与确认的批次不一致")
		}
		var row model.StudioTemplate
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&row, "id = ?", item.TemplateID).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return reject("模板已删除")
			}
			return err
		}
		if strings.TrimSpace(row.CoverURL) != "" || row.Title != item.Title || row.Description != item.Description || row.Category != item.Category {
			return reject("模板已变更或已有封面，不再提交生成")
		}
		return nil
	}
	return reject("模板不属于当前批次")
}

type TemplateCoverPlan struct {
	ModelID   string         `json:"modelId"`
	ModelName string         `json:"modelName"`
	ModelHash string         `json:"-"`
	PointCost int            `json:"pointCost"`
	Input     map[string]any `json:"-"`
}

func templateCoverModelAllowed(m *model.AiModel) bool {
	if m == nil || m.Type != "image" || m.ModelID == "" || !m.Enabled ||
		!model.ModelConfigTemplateCoverBatch(m.Config) || validateModelAvailability(m) != nil ||
		!modelSupportsHandler(m, "text_to_image") {
		return false
	}
	var cfg map[string]any
	_ = json.Unmarshal([]byte(m.Config), &cfg)
	modes := inputStrings(cfg, "modes")
	if len(modes) == 0 {
		return true
	}
	for _, mode := range modes {
		if mode == "t2i" {
			return true
		}
	}
	return false
}

func templateCoverModelHash(m *model.AiModel) string {
	raw, _ := json.Marshal([]any{m.ID, m.ModelID, m.Config, m.PointCost})
	sum := sha256.Sum256(raw)
	return hex.EncodeToString(sum[:])
}

// Uses the actual generation pricing function, never a client estimate.
func PlanTemplateCover(ctx context.Context, db *gorm.DB, row model.StudioTemplate) (TemplateCoverPlan, error) {
	var models []model.MarketModel
	if err := db.WithContext(ctx).Where("type = ? AND status = ?", "image", 1).Order("sort_order ASC, id ASC").Find(&models).Error; err != nil {
		return TemplateCoverPlan{}, err
	}
	for i := range models {
		m := marketToAiModel(&models[i])
		if !templateCoverModelAllowed(&m) {
			continue
		}
		var cfg map[string]any
		_ = json.Unmarshal([]byte(m.Config), &cfg)
		input := map[string]any{"prompt": TemplateCoverPrompt(row), "batchCount": 1}
		for _, spec := range []struct{ key, list string }{{"aspectRatio", "ratios"}, {"resolution", "resolutions"}, {"quality", "qualities"}} {
			values := inputStrings(cfg, spec.list)
			if len(values) == 0 {
				continue
			}
			value := values[0]
			if spec.key == "aspectRatio" {
				for _, ratio := range values {
					if ratio == "16:9" {
						value = ratio
						break
					}
				}
			}
			input[spec.key] = value
		}
		raw, _ := json.Marshal(input)
		cost := resolveCost(&m, raw)
		if cost < 0 {
			return TemplateCoverPlan{}, errors.New("封面模型积分配置无效")
		}
		// Pin the catalog row, not just an upstream key that another configured
		// model can share. The provider still receives m.ModelID after resolution.
		return TemplateCoverPlan{ModelID: m.ID.String(), ModelName: m.Name, ModelHash: templateCoverModelHash(&m), PointCost: cost, Input: input}, nil
	}
	return TemplateCoverPlan{}, errors.New("请先在模型管理中为已上架、正常且支持文生图的图片模型开启「创作模板批量封面」")
}

func TemplateCoverPrompt(row model.StudioTemplate) string {
	clip := func(s string, n int) string {
		r := []rune(strings.TrimSpace(s))
		if len(r) > n {
			r = r[:n]
		}
		return string(r)
	}
	return fmt.Sprintf("为创作模板「%s」生成一张商业摄影风格的封面示意图。\n主题分类：%s。\n内容介绍：%s。\n只输出一张完整静态图片，主体突出、光线自然、构图清晰，适合模板列表展示。用相关场景、物品或虚构成年人表达用途，不画视频时长，不使用分镜或界面截图。不要文字、数字、店名、品牌、水印、地址、电话、价格或资质标识。只作创意示意，不宣称真实门店或已生成视频。", clip(row.Title, 128), clip(row.Category, 64), clip(row.Description, 512))
}
