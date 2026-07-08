package billing

// faq.go — 定价页「常见问题 FAQ」（sys_config: pricing.faq）。
//
// 与 compare.go 同一套路：单 JSON 文档存 sys_config，公开端点与管理端共用
// Load/Save，键从未保存过时回落到出厂内容（原前端写死的 6 条）。

import (
	"encoding/json"
	"errors"

	"gorm.io/gorm"

	"tidecanvas/internal/model"
)

// FaqItem is one question/answer pair on the pricing page.
type FaqItem struct {
	Q string `json:"q"`
	A string `json:"a"`
}

// FaqVO is the stored / served FAQ document.
type FaqVO struct {
	Items []FaqItem `json:"items"`
}

// defaultFaq is the factory FAQ (the legacy hard-coded PRICING_FAQS content).
var defaultFaq = []FaqItem{
	{"积分是怎么计算的？", "每次生成会按模型与分辨率消耗对应积分，标准图片约 1 积分/张，高清与视频按算力计费。生成前会显示预估消耗。"},
	{"可以随时升级或降级吗？", "可以。升级立即生效并按比例计费；降级会在当前账期结束后生效，已购积分继续有效。"},
	{"没用完的积分会过期吗？", "不会。套餐发放的积分计入账户余额，长期有效，升级或续费后余额继续累加。"},
	{"支持哪些支付方式？", "支持微信支付、支付宝以及主流信用卡。企业版可申请对公转账与发票。"},
	{"生成的作品版权归谁？", "你拥有自己生成作品的使用权。Pro 及以上方案附带商用授权，可用于商业项目。"},
	{"免费版有什么限制？", "免费版每月赠送 100 积分，可使用基础图片模型与标准队列，适合尝鲜与轻度创作。"},
}

// LoadFaq returns the effective FAQ: the stored sys_config JSON when
// present/valid, else the factory default.
func LoadFaq(db *gorm.DB) (FaqVO, error) {
	var row model.SysConfig
	err := db.Where("config_key = ?", model.ConfigKeyPricingFaq).First(&row).Error
	if err == nil && row.ConfigValue != "" {
		var vo FaqVO
		if jsonErr := json.Unmarshal([]byte(row.ConfigValue), &vo); jsonErr == nil && vo.Items != nil {
			return vo, nil
		}
	}
	if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return FaqVO{Items: []FaqItem{}}, err
	}
	return FaqVO{Items: defaultFaq}, nil
}

// SaveFaq persists the FAQ JSON into sys_config (upsert).
func SaveFaq(db *gorm.DB, vo FaqVO) error {
	if vo.Items == nil {
		vo.Items = []FaqItem{}
	}
	b, err := json.Marshal(vo)
	if err != nil {
		return err
	}
	var row model.SysConfig
	err = db.Where("config_key = ?", model.ConfigKeyPricingFaq).First(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return db.Create(&model.SysConfig{
			ConfigKey:   model.ConfigKeyPricingFaq,
			ConfigValue: string(b),
			Group:       "pricing",
			Description: "定价页常见问题 FAQ",
		}).Error
	}
	if err != nil {
		return err
	}
	return db.Model(&row).Update("config_value", string(b)).Error
}
