package setting

import (
	"fmt"
	"strconv"
)

// Service 系统设置业务（对齐 AdminSettingController）。
type Service struct {
	repo *Repository
}

// NewService 构造。
func NewService(repo *Repository) *Service {
	return &Service{repo: repo}
}

// Get 读取全部系统配置（对齐 get）：返回 key→value 字符串映射，前端按 SETTING_GROUPS 自取所需键。
func (s *Service) Get() (map[string]string, error) {
	return s.repo.LoadAll()
}

// Save 批量保存配置（对齐 update）：逐项 upsert（存在则更新 value，否则插入）。
//
// 前端 settings.save 传 Record<string, unknown>（toggle→bool、number→数字、text→字符串），
// sys_config.config_value 为字符串列，故统一字符串化后存储；GET 亦返回字符串，前端
// renderField 自行还原（"true"/"1"→开关，数字串→数值）。任一项失败即返回错误（与逐条更新一致）。
func (s *Service) Save(settings map[string]interface{}) error {
	for key, raw := range settings {
		if err := s.repo.Upsert(key, toConfigValue(raw)); err != nil {
			return err
		}
	}
	return nil
}

// toConfigValue 将任意 JSON 标量值转为入库字符串（对齐旧后端 Map<String,String> 的 Jackson 强转语义）。
//   - nil          → ""（清空）
//   - bool         → "true"/"false"
//   - 数字(float64) → 整数无小数位则去尾零（如 100 而非 100.000000），否则用最短表示
//   - string       → 原样
//   - 其他         → fmt 默认
func toConfigValue(raw interface{}) string {
	switch v := raw.(type) {
	case nil:
		return ""
	case string:
		return v
	case bool:
		return strconv.FormatBool(v)
	case float64:
		// JSON 数字统一解析为 float64；整数值去掉小数尾巴（前端 number 字段多为整数）。
		if v == float64(int64(v)) {
			return strconv.FormatInt(int64(v), 10)
		}
		return strconv.FormatFloat(v, 'f', -1, 64)
	case float32:
		f := float64(v)
		if f == float64(int64(f)) {
			return strconv.FormatInt(int64(f), 10)
		}
		return strconv.FormatFloat(f, 'f', -1, 64)
	case int:
		return strconv.Itoa(v)
	case int64:
		return strconv.FormatInt(v, 10)
	default:
		return fmt.Sprintf("%v", v)
	}
}
