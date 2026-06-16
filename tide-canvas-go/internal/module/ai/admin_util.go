package ai

import (
	"encoding/json"
	"sort"
	"strconv"
	"strings"

	"github.com/shopspring/decimal"
	"gorm.io/datatypes"
)

// ===== 管理端请求体（map[string]interface{}）取值 / 类型转换辅助 =====
// 忠实迁移 AdminAiController 的「body.containsKey(k) ? cast : 默认」局部更新风格：
// 仅当请求体包含某字段时才更新对应列（setIfPresent），缺省字段保持原值。

// parseInt64 解析 int64 路径参数（provider/model 主键），失败返回 (0,false)。
func parseInt64(s string) (int64, bool) {
	if s == "" {
		return 0, false
	}
	n, err := strconv.ParseInt(s, 10, 64)
	if err != nil {
		return 0, false
	}
	return n, true
}

// intOrDefault 从 body 值取 int，缺省/非法返回 def（对齐 body.containsKey ? (Integer) : 默认）。
func intOrDefault(v interface{}, def int) int {
	if n, ok := toInt(v); ok {
		return n
	}
	return def
}

// asString 转字符串（body 值恒为可转，配合 setIfPresent）。
func asString(v interface{}) (interface{}, bool) {
	return strOf(v), true
}

// asInt 转 int（JSON 数字为 float64；字符串数字也兼容）。
func asInt(v interface{}) (interface{}, bool) {
	n, ok := toInt(v)
	return n, ok
}

// toInt 尽力转 int。
func toInt(v interface{}) (int, bool) {
	switch t := v.(type) {
	case float64:
		return int(t), true
	case int:
		return t, true
	case int64:
		return int(t), true
	case string:
		n, err := strconv.Atoi(strings.TrimSpace(t))
		if err != nil {
			return 0, false
		}
		return n, true
	default:
		return 0, false
	}
}

// asInt64 尽力转 int64（providerId / defaultModelId）。
func asInt64(v interface{}) (int64, bool) {
	switch t := v.(type) {
	case float64:
		return int64(t), true
	case int64:
		return t, true
	case int:
		return int64(t), true
	case string:
		n, err := strconv.ParseInt(strings.TrimSpace(t), 10, 64)
		if err != nil {
			return 0, false
		}
		return n, true
	default:
		return 0, false
	}
}

// asDecimal 尽力转 decimal（pointCost / costPerCall，支持小数定价）。
func asDecimal(v interface{}) (decimal.Decimal, bool) {
	switch t := v.(type) {
	case float64:
		return decimal.NewFromFloat(t), true
	case string:
		d, err := decimal.NewFromString(strings.TrimSpace(t))
		if err != nil {
			return decimal.Zero, false
		}
		return d, true
	default:
		return decimal.Zero, false
	}
}

// setIfPresent 当 body 含 key 时，用 conv 转换后写入 columns[col]（缺省字段不更新）。
func setIfPresent(body map[string]interface{}, key string, columns map[string]interface{}, col string, conv func(interface{}) (interface{}, bool)) {
	v, ok := body[key]
	if !ok {
		return
	}
	cv, ok := conv(v)
	if !ok {
		return
	}
	columns[col] = cv
}

// jsonColumn 把任意值序列化为 datatypes.JSON（model.config 等 JSON 列）。
// 对齐旧 model.setConfig(body.get("config").toString())：若已是字符串原样存，否则序列化。
func jsonColumn(v interface{}) datatypes.JSON {
	if s, ok := v.(string); ok {
		return datatypes.JSON(s)
	}
	b, err := json.Marshal(v)
	if err != nil {
		return datatypes.JSON("{}")
	}
	return datatypes.JSON(b)
}

// supportedHandlersJSON 前端传入的 supportedHandlers(List) → JSON 数组；空集合/非数组返回空（落 NULL，语义不限制）。
// 对齐 toSupportedHandlersJson。
func supportedHandlersJSON(v interface{}) datatypes.JSON {
	list, ok := v.([]interface{})
	if !ok || len(list) == 0 {
		return nil
	}
	out := make([]string, 0, len(list))
	for _, item := range list {
		out = append(out, strOf(item))
	}
	b, err := json.Marshal(out)
	if err != nil {
		return nil
	}
	return datatypes.JSON(b)
}

// appendUniq 追加去重（enrich 收集 id 集合）。
func appendUniq(list []int64, v int64) []int64 {
	for _, x := range list {
		if x == v {
			return list
		}
	}
	return append(list, v)
}

// sortStringsFold 不区分大小写升序排序（远程模型 id 列表，对齐 sorted(String::compareToIgnoreCase)）。
func sortStringsFold(s []string) {
	sort.Slice(s, func(i, j int) bool {
		return strings.ToLower(s[i]) < strings.ToLower(s[j])
	})
}
