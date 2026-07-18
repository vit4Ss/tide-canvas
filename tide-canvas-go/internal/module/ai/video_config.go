package ai

import (
	"encoding/json"
	"fmt"
	"strings"

	"github.com/shopspring/decimal"
)

var allowedVideoRatios = []string{"auto", "21:9", "16:9", "4:3", "1:1", "3:4", "9:16"}
var allowedVideoResolutions = []string{"480p", "720p", "768p", "1080p", "4k"}

func isVideoGenerationHandler(name string) bool {
	switch name {
	case "text_to_video", "image_to_video", "start_end_to_video", "reference_to_video":
		return true
	default:
		return false
	}
}

type videoCapabilities struct {
	ratios      []string
	resolutions []string
	durations   []int
	audio       bool
}

func decodeVideoConfig(raw []byte) (map[string]interface{}, error) {
	if len(raw) == 0 || strings.TrimSpace(string(raw)) == "" || strings.TrimSpace(string(raw)) == "null" {
		return nil, fmt.Errorf("视频模型参数配置不能为空")
	}
	var config map[string]interface{}
	if err := json.Unmarshal(raw, &config); err != nil || config == nil {
		return nil, fmt.Errorf("视频模型参数配置格式不正确")
	}
	return config, nil
}

func configStringValues(config map[string]interface{}, key string) []string {
	raw, ok := config[key].([]interface{})
	if !ok {
		return nil
	}
	values := make([]string, 0, len(raw))
	seen := map[string]struct{}{}
	for _, item := range raw {
		value := strings.TrimSpace(strOf(item))
		key := strings.ToLower(value)
		if value == "" {
			continue
		}
		if _, exists := seen[key]; exists {
			continue
		}
		seen[key] = struct{}{}
		values = append(values, value)
	}
	return values
}

func configIntValues(config map[string]interface{}, key string) []int {
	raw, ok := config[key].([]interface{})
	if !ok {
		return nil
	}
	values := make([]int, 0, len(raw))
	seen := map[int]struct{}{}
	for _, item := range raw {
		value, ok := toInt(item)
		if !ok {
			continue
		}
		if _, exists := seen[value]; exists {
			continue
		}
		seen[value] = struct{}{}
		values = append(values, value)
	}
	return values
}

func configBool(config map[string]interface{}, key string, fallback bool) bool {
	value, exists := config[key]
	if !exists || value == nil {
		return fallback
	}
	switch typed := value.(type) {
	case bool:
		return typed
	case string:
		return strings.EqualFold(strings.TrimSpace(typed), "true") || strings.TrimSpace(typed) == "1"
	case float64:
		return typed != 0
	default:
		return fallback
	}
}

func parseVideoCapabilities(raw []byte) (videoCapabilities, map[string]interface{}, error) {
	config, err := decodeVideoConfig(raw)
	if err != nil {
		return videoCapabilities{}, nil, err
	}
	capabilities := videoCapabilities{
		ratios:      configStringValues(config, "ratios"),
		resolutions: configStringValues(config, "resolutions"),
		durations:   configIntValues(config, "durations"),
		audio:       configBool(config, "audio", true),
	}
	return capabilities, config, nil
}

func containsFold(values []string, target string) bool {
	for _, value := range values {
		if strings.EqualFold(value, target) {
			return true
		}
	}
	return false
}

func validateVideoModelConfig(raw []byte, requirePricing bool) error {
	capabilities, config, err := parseVideoCapabilities(raw)
	if err != nil {
		return err
	}
	if len(capabilities.ratios) == 0 || len(capabilities.resolutions) == 0 || len(capabilities.durations) == 0 {
		return fmt.Errorf("视频模型的比例、清晰度和时长都必须至少配置一项")
	}
	for _, ratio := range capabilities.ratios {
		if !containsFold(allowedVideoRatios, ratio) {
			return fmt.Errorf("不支持的视频比例: %s", ratio)
		}
	}
	for _, resolution := range capabilities.resolutions {
		if !containsFold(allowedVideoResolutions, resolution) {
			return fmt.Errorf("不支持的视频清晰度: %s", resolution)
		}
	}
	for _, duration := range capabilities.durations {
		if duration < 4 || duration > 30 {
			return fmt.Errorf("视频时长必须在 4–30 秒之间")
		}
	}
	if !requirePricing {
		return nil
	}
	for _, resolution := range capabilities.resolutions {
		if _, err := videoSecondRate(config, resolution, false); err != nil {
			return fmt.Errorf("清晰度 %s 缺少无音频每秒单价", strings.ToUpper(resolution))
		}
		if capabilities.audio {
			if _, err := videoSecondRate(config, resolution, true); err != nil {
				return fmt.Errorf("清晰度 %s 缺少有音频每秒单价", strings.ToUpper(resolution))
			}
		}
	}
	return nil
}

func pricingRow(config map[string]interface{}, resolution string) map[string]interface{} {
	pricing, ok := config["secondPricing"].(map[string]interface{})
	if !ok {
		return nil
	}
	for key, raw := range pricing {
		if !strings.EqualFold(key, resolution) {
			continue
		}
		row, _ := raw.(map[string]interface{})
		return row
	}
	return nil
}

func videoSecondRate(config map[string]interface{}, resolution string, audio bool) (decimal.Decimal, error) {
	row := pricingRow(config, resolution)
	if row == nil {
		return decimal.Zero, fmt.Errorf("missing pricing")
	}
	field := "withoutAudio"
	if audio {
		field = "withAudio"
	}
	rate, ok := asDecimal(row[field])
	if !ok || rate.Sign() <= 0 {
		return decimal.Zero, fmt.Errorf("invalid pricing")
	}
	return rate, nil
}

func requestedVideoRatio(input map[string]interface{}) string {
	for _, key := range []string{"aspectRatio", "aspect_ratio", "ratio", "aspect"} {
		if value := strings.TrimSpace(strOf(input[key])); value != "" {
			return value
		}
	}
	return "auto"
}

func requestedVideoAudio(input map[string]interface{}) bool {
	for _, key := range []string{"audio", "generateAudio"} {
		value, exists := input[key]
		if !exists || value == nil {
			continue
		}
		switch typed := value.(type) {
		case bool:
			return typed
		case string:
			return strings.EqualFold(strings.TrimSpace(typed), "true") || strings.TrimSpace(typed) == "1"
		case float64:
			return typed != 0
		}
	}
	return false
}

func validateVideoModelInput(raw []byte, input map[string]interface{}) error {
	capabilities, _, err := parseVideoCapabilities(raw)
	if err != nil {
		return err
	}
	ratio := requestedVideoRatio(input)
	if !containsFold(capabilities.ratios, ratio) {
		return fmt.Errorf("当前模型不支持画面比例 %s", ratio)
	}
	resolution := resolutionOf(input)
	if resolution == "" || !containsFold(capabilities.resolutions, resolution) {
		return fmt.Errorf("当前模型不支持清晰度 %s", strings.ToUpper(resolution))
	}
	duration := durationInt(input)
	if duration == nil || !containsInt(capabilities.durations, *duration) {
		return fmt.Errorf("当前模型不支持该视频时长")
	}
	if requestedVideoAudio(input) && !capabilities.audio {
		return fmt.Errorf("当前模型不支持生成音频")
	}
	return nil
}

func containsInt(values []int, target int) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}

func videoBasePrice(raw []byte, input map[string]interface{}) (decimal.Decimal, error) {
	_, config, err := parseVideoCapabilities(raw)
	if err != nil {
		return decimal.Zero, err
	}
	duration := durationInt(input)
	if duration == nil || *duration <= 0 {
		return decimal.Zero, fmt.Errorf("视频时长不能为空")
	}
	rate, err := videoSecondRate(config, resolutionOf(input), requestedVideoAudio(input))
	if err != nil {
		return decimal.Zero, fmt.Errorf("当前视频参数缺少每秒积分单价")
	}
	return rate.Mul(decimal.NewFromInt(int64(*duration))), nil
}

func validateVideoRouteConditions(modelConfig []byte, conditions []byte) error {
	capabilities, _, err := parseVideoCapabilities(modelConfig)
	if err != nil {
		return err
	}
	if len(conditions) == 0 || strings.TrimSpace(string(conditions)) == "" || strings.TrimSpace(string(conditions)) == "null" {
		return nil
	}
	var config map[string]interface{}
	if err := json.Unmarshal(conditions, &config); err != nil {
		return fmt.Errorf("路由条件格式不正确")
	}
	for _, value := range conditionStringValues(config, "resolutions", "resolution") {
		if !containsFold(capabilities.resolutions, value) {
			return fmt.Errorf("路由清晰度 %s 超出模型能力范围", strings.ToUpper(value))
		}
	}
	for _, value := range conditionStringValues(config, "ratios", "aspectRatios", "aspectRatio", "ratio") {
		if !containsFold(capabilities.ratios, value) {
			return fmt.Errorf("路由比例 %s 超出模型能力范围", value)
		}
	}
	for _, value := range conditionIntValues(config, "durations", "duration") {
		if !containsInt(capabilities.durations, value) {
			return fmt.Errorf("路由时长 %ds 超出模型能力范围", value)
		}
	}
	return nil
}
