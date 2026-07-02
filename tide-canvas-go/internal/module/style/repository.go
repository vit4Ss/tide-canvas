package style

import (
	"errors"
	"strings"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"github.com/tidecanvas/tide-canvas-go/internal/model"
)

// Repository 封装风格库相关的数据访问。
type Repository struct {
	db *gorm.DB
}

// NewRepository 创建风格库仓储。
func NewRepository(db *gorm.DB) *Repository { return &Repository{db: db} }

// DB 暴露底层连接，供初始化种子数据使用。
func (r *Repository) DB() *gorm.DB { return r.db }

// PagePresets 分页查询风格预设，userID 为当前用户内部 ID，adminMode 为后台列表。
func (r *Repository) PagePresets(userID int64, q *PresetQuery, adminMode bool) ([]model.StylePreset, int64, error) {
	tx := r.filteredQuery(userID, q, adminMode)
	var total int64
	if err := tx.Count(&total).Error; err != nil {
		return nil, 0, err
	}

	var records []model.StylePreset
	orderBy := "official DESC, sort_order DESC, usage_count DESC, create_time DESC"
	if strings.EqualFold(q.Source, "recent") {
		orderBy = "su.update_time DESC"
	}
	if err := r.filteredQuery(userID, q, adminMode).
		Order(orderBy).
		Offset(q.Offset()).Limit(q.PageSize).
		Find(&records).Error; err != nil {
		return nil, 0, err
	}
	return records, total, nil
}

func (r *Repository) filteredQuery(userID int64, q *PresetQuery, adminMode bool) *gorm.DB {
	tx := r.db.Model(&model.StylePreset{})
	source := strings.ToLower(strings.TrimSpace(q.Source))
	if source == "" {
		source = "gallery"
	}

	if source == "favorite" && userID > 0 {
		tx = tx.Joins("JOIN style_favorite sf ON sf.style_id = style_preset.id AND sf.user_id = ?", userID)
	}
	if source == "recent" && userID > 0 {
		tx = tx.Joins("JOIN style_usage su ON su.style_id = style_preset.id AND su.user_id = ?", userID)
	}

	if !adminMode {
		tx = tx.Where("style_preset.status = ?", 1)
		switch source {
		case "mine":
			tx = tx.Where("style_preset.owner_user_id = ?", userID)
		case "favorite", "recent":
			tx = tx.Where("(style_preset.public_flag = 1 OR style_preset.owner_user_id = ?)", userID)
		default:
			tx = tx.Where("style_preset.public_flag = 1")
		}
	} else if q.Status != nil {
		tx = tx.Where("style_preset.status = ?", *q.Status)
	}

	if q.Keyword = strings.TrimSpace(q.Keyword); q.Keyword != "" {
		like := "%" + q.Keyword + "%"
		tx = tx.Where("(style_preset.name LIKE ? OR style_preset.description LIKE ? OR style_preset.author_name LIKE ?)", like, like, like)
	}
	if q.Category = strings.TrimSpace(q.Category); q.Category != "" && q.Category != "推荐" {
		tx = tx.Where("style_preset.category = ?", q.Category)
	}
	if q.ModelID = strings.TrimSpace(q.ModelID); q.ModelID != "" {
		tx = tx.Where(`(
			(JSON_LENGTH(COALESCE(style_preset.model_ids, JSON_ARRAY())) > 0
				AND JSON_CONTAINS(COALESCE(style_preset.model_ids, JSON_ARRAY()), JSON_QUOTE(?)))
			OR (JSON_LENGTH(COALESCE(style_preset.model_ids, JSON_ARRAY())) = 0
				AND (style_preset.model_id = '' OR style_preset.model_id = ?))
		)`, q.ModelID, q.ModelID)
	}
	if q.CommercialOnly {
		tx = tx.Where("style_preset.commercial = ?", 1)
	}
	return tx
}

// FavoriteMap 返回当前页风格的收藏状态。
func (r *Repository) FavoriteMap(userID int64, styleIDs []int64) (map[int64]bool, error) {
	out := make(map[int64]bool, len(styleIDs))
	if userID <= 0 || len(styleIDs) == 0 {
		return out, nil
	}
	var rows []model.StyleFavorite
	if err := r.db.Select("style_id").Where("user_id = ? AND style_id IN ?", userID, styleIDs).Find(&rows).Error; err != nil {
		return nil, err
	}
	for _, row := range rows {
		out[row.StyleID] = true
	}
	return out, nil
}

// FindByPublicID 按对外 ID 查询风格预设。
func (r *Repository) FindByPublicID(publicID string) (*model.StylePreset, error) {
	var preset model.StylePreset
	err := r.db.Where("public_id = ?", publicID).First(&preset).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &preset, nil
}

// CreatePreset 新增风格预设。
func (r *Repository) CreatePreset(p *model.StylePreset) error {
	return r.db.Create(p).Error
}

// UpdatePresetColumns 局部更新风格预设。
func (r *Repository) UpdatePresetColumns(id int64, columns map[string]interface{}) error {
	if len(columns) == 0 {
		return nil
	}
	return r.db.Model(&model.StylePreset{}).Where("id = ?", id).Updates(columns).Error
}

// DeletePreset 逻辑删除风格预设。
func (r *Repository) DeletePreset(id int64) error {
	return r.db.Delete(&model.StylePreset{}, id).Error
}

// ToggleFavorite 切换收藏状态，并返回最终是否收藏。
func (r *Repository) ToggleFavorite(userID, styleID int64) (bool, error) {
	var fav model.StyleFavorite
	err := r.db.Where("user_id = ? AND style_id = ?", userID, styleID).First(&fav).Error
	if err == nil {
		if err := r.db.Delete(&model.StyleFavorite{}, fav.ID).Error; err != nil {
			return false, err
		}
		return false, nil
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return false, err
	}
	if err := r.db.Create(&model.StyleFavorite{UserID: userID, StyleID: styleID}).Error; err != nil {
		return false, err
	}
	return true, nil
}

// RecordUse 记录最近使用并累加风格使用次数。
func (r *Repository) RecordUse(userID, styleID int64) error {
	now := time.Now()
	return r.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Model(&model.StylePreset{}).Where("id = ?", styleID).
			UpdateColumn("usage_count", gorm.Expr("usage_count + ?", 1)).Error; err != nil {
			return err
		}
		usage := model.StyleUsage{UserID: userID, StyleID: styleID, UseCount: 1}
		return tx.Clauses(clause.OnConflict{
			Columns: []clause.Column{{Name: "user_id"}, {Name: "style_id"}},
			DoUpdates: clause.Assignments(map[string]interface{}{
				"use_count":   gorm.Expr("use_count + ?", 1),
				"update_time": now,
			}),
		}).Create(&usage).Error
	})
}

// CountOfficialSeeds 用于判断是否需要初始化内置风格。
func (r *Repository) CountOfficialSeeds() (int64, error) {
	var total int64
	err := r.db.Model(&model.StylePreset{}).Where("official = ? AND owner_user_id IS NULL", 1).Count(&total).Error
	return total, err
}
