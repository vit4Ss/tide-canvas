package model

import (
	"encoding/json"
	"errors"
)

func ModelConfigTemplateCoverBatch(raw string) bool {
	var cfg struct {
		Enabled bool `json:"templateCoverBatch"`
	}
	return json.Unmarshal([]byte(raw), &cfg) == nil && cfg.Enabled
}

func ValidateTemplateCoverConfig(typ string, raw json.RawMessage) error {
	if len(raw) == 0 {
		return nil
	}
	var cfg map[string]json.RawMessage
	if json.Unmarshal(raw, &cfg) != nil {
		return errors.New("模型配置必须是 JSON 对象")
	}
	value, exists := cfg["templateCoverBatch"]
	if !exists {
		return nil
	}
	var enabled bool
	if string(value) == "null" || json.Unmarshal(value, &enabled) != nil {
		return errors.New("创作模板批量封面开关必须为开启或关闭")
	}
	if !enabled {
		return nil
	}
	if typ != "image" {
		return errors.New("只有图片模型可以开启创作模板批量封面")
	}
	if v, ok := cfg["modes"]; ok {
		var modes []string
		if json.Unmarshal(v, &modes) != nil {
			return errors.New("图片模型的生成方式配置无效")
		}
		if len(modes) > 0 {
			for _, mode := range modes {
				if mode == "t2i" {
					return nil
				}
			}
			return errors.New("批量封面模型需要支持文生图")
		}
	}
	return nil
}
