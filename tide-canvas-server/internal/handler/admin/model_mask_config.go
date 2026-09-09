package admin

import (
	"encoding/json"
	"errors"
)

func validateMaskConfig(typ string, raw json.RawMessage) error {
	if len(raw) == 0 {
		return nil
	}
	var cfg map[string]json.RawMessage
	if json.Unmarshal(raw, &cfg) != nil {
		return errors.New("模型配置必须是 JSON 对象")
	}
	if value, exists := cfg["supportsMask"]; exists {
		var enabled bool
		if string(value) == "null" || json.Unmarshal(value, &enabled) != nil {
			return errors.New("支持蒙版必须为开启或关闭")
		}
		if enabled && typ != "image" {
			return errors.New("只有图片模型可以开启支持蒙版")
		}
	}
	return nil
}
