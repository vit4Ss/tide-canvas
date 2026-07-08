package billing

// compare.go — 定价页「方案对比」表（sys_config: pricing.compare）。
//
// 只存行（能力项 + 每套餐一格），不存列：公开页与后台编辑器的列都取自真实
// 套餐目录，套餐的改名 / 排序 / 推荐标记 / 上下架自动反映到对比表。格子的值
// 以套餐 ID（十进制字符串）为键，套餐删除后遗留的键无害，前端查不到即按
// "—" 渲染。LoadCompare / SaveCompare 同时被公开端点（handler.go）与管理端
// （handler/admin g4_pricing）消费，保证两边看到同一份有效数据。

import (
	"encoding/json"
	"errors"

	"gorm.io/gorm"

	"tidecanvas/internal/model"
)

// CompareRow is one capability row: label + per-plan cell values keyed by the
// plan's decimal-string id. Cell convention: "✓" 支持 / "—" 不支持 / 任意文字。
type CompareRow struct {
	Label  string            `json:"label"`
	Values map[string]string `json:"values"`
}

// CompareVO is the stored / served compare-table document.
type CompareVO struct {
	Rows []CompareRow `json:"rows"`
}

// defaultCompareByCode is the factory table (the legacy hard-coded 方案对比
// content), keyed by plan code so it can be translated onto live plan ids at
// serve time when the sys_config key has never been saved.
var defaultCompareByCode = []struct {
	label  string
	byCode map[string]string
}{
	{"每月积分", map[string]string{"free": "100", "pro": "3,000", "enterprise": "无限"}},
	{"图片模型", map[string]string{"free": "基础", "pro": "全部", "enterprise": "全部 + 私有"}},
	{"视频模型", map[string]string{"free": "—", "pro": "全部", "enterprise": "全部"}},
	{"生成速度", map[string]string{"free": "标准", "pro": "优先不限速", "enterprise": "最高优先"}},
	{"最高分辨率", map[string]string{"free": "512²", "pro": "4K", "enterprise": "4K"}},
	{"商用授权", map[string]string{"free": "—", "pro": "✓", "enterprise": "✓"}},
	{"API 接入", map[string]string{"free": "—", "pro": "—", "enterprise": "✓"}},
	{"团队协作", map[string]string{"free": "—", "pro": "—", "enterprise": "✓"}},
}

// LoadCompare returns the effective compare table: the stored sys_config JSON
// when present/valid, else the factory default translated onto current plans.
func LoadCompare(db *gorm.DB) (CompareVO, error) {
	var row model.SysConfig
	err := db.Where("config_key = ?", model.ConfigKeyPricingCompare).First(&row).Error
	if err == nil && row.ConfigValue != "" {
		var vo CompareVO
		if jsonErr := json.Unmarshal([]byte(row.ConfigValue), &vo); jsonErr == nil && vo.Rows != nil {
			return vo, nil
		}
	}
	if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return CompareVO{Rows: []CompareRow{}}, err
	}
	return defaultCompare(db)
}

// defaultCompare builds the factory table against the live plan catalog.
func defaultCompare(db *gorm.DB) (CompareVO, error) {
	var plans []model.Plan
	if err := db.Order("sort_order ASC, id ASC").Find(&plans).Error; err != nil {
		return CompareVO{Rows: []CompareRow{}}, err
	}
	idByCode := map[string]string{}
	for i := range plans {
		if plans[i].Code != "" {
			idByCode[plans[i].Code] = plans[i].ID.String()
		}
	}
	rows := make([]CompareRow, 0, len(defaultCompareByCode))
	for _, d := range defaultCompareByCode {
		values := map[string]string{}
		for code, cell := range d.byCode {
			if id, ok := idByCode[code]; ok {
				values[id] = cell
			}
		}
		rows = append(rows, CompareRow{Label: d.label, Values: values})
	}
	return CompareVO{Rows: rows}, nil
}

// SaveCompare persists the compare table JSON into sys_config (upsert).
func SaveCompare(db *gorm.DB, vo CompareVO) error {
	if vo.Rows == nil {
		vo.Rows = []CompareRow{}
	}
	b, err := json.Marshal(vo)
	if err != nil {
		return err
	}
	var row model.SysConfig
	err = db.Where("config_key = ?", model.ConfigKeyPricingCompare).First(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return db.Create(&model.SysConfig{
			ConfigKey:   model.ConfigKeyPricingCompare,
			ConfigValue: string(b),
			Group:       "pricing",
			Description: "定价页方案对比表（行内容；列=真实套餐）",
		}).Error
	}
	if err != nil {
		return err
	}
	return db.Model(&row).Update("config_value", string(b)).Error
}
