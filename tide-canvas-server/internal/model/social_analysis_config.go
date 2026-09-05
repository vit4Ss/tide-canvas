package model

import "strconv"

const (
	ConfigGroupSocialAnalysis    = "内容拆解"
	ConfigKeySocialTikHubEnabled = "social.tikhub.enabled"
	ConfigKeySocialTikHubBaseURL = "social.tikhub.baseUrl"
	ConfigKeySocialTikHubAPIKey  = "social.tikhub.apiKey"
	DefaultSocialTikHubBaseURL   = "https://api.tikhub.io"
	ConfigKeySocialDownloadCost  = "social.download.pointCost"
	ConfigKeySocialAnalysisCost  = "social.analysis.pointCost"
)

// SocialAnalysisConfigKeys are protected baseline keys used by the
// multi-platform content-analysis workbench.
var SocialAnalysisConfigKeys = []string{
	ConfigKeySocialTikHubEnabled,
	ConfigKeySocialTikHubBaseURL,
	ConfigKeySocialTikHubAPIKey,
	ConfigKeySocialDownloadCost,
	ConfigKeySocialAnalysisCost,
}

// SocialAnalysisBaselineConfigs seeds the integration without a credential.
// Operators enter the API key in the generic configuration screen.
func SocialAnalysisBaselineConfigs() []SysConfig {
	return []SysConfig{
		{ConfigKey: ConfigKeySocialDownloadCost, ConfigValue: "1", Group: ConfigGroupSocialAnalysis, Description: "视频下载单次积分；1-100000 整数，解析前预扣，失败或未下载过期退回，已收到的文件再次保存不扣费"},
		{ConfigKey: ConfigKeySocialAnalysisCost, ConfigValue: "1", Group: ConfigGroupSocialAnalysis, Description: "内容拆解单次积分；1-100000 整数，包含本次数据解析及一次 AI 报告，失败退回，查看历史不扣费"},
		{
			ConfigKey:   ConfigKeySocialTikHubEnabled,
			ConfigValue: "1",
			Group:       ConfigGroupSocialAnalysis,
			Description: "多平台内容拆解开关；1=启用，0=停用，保存后即时生效",
		},
		{
			ConfigKey:   ConfigKeySocialTikHubBaseURL,
			ConfigValue: DefaultSocialTikHubBaseURL,
			Group:       ConfigGroupSocialAnalysis,
			Description: "TikHub API 地址；默认使用官方 https://api.tikhub.io，通常无需修改",
		},
		{
			ConfigKey:   ConfigKeySocialTikHubAPIKey,
			ConfigValue: "",
			Group:       ConfigGroupSocialAnalysis,
			Description: "TikHub Bearer Token；仅保存在后端并脱敏展示，粘贴令牌本身即可",
		},
	}
}

func ParseSocialPointCost(raw string) (int, bool) {
	if raw == "" {
		return 0, false
	}
	for _, c := range raw {
		if c < '0' || c > '9' {
			return 0, false
		}
	}
	n, err := strconv.Atoi(raw)
	return n, err == nil && n >= 1 && n <= 100000
}

// IsSecretConfigKey reports every sys_config value that must never be exposed
// by the generic admin configuration API.
func IsSecretConfigKey(key string) bool {
	return key == ConfigKeySocialTikHubAPIKey || IsSupplierBalanceSecretConfigKey(key)
}
