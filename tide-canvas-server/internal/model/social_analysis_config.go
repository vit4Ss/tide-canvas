package model

const (
	ConfigGroupSocialAnalysis    = "内容拆解"
	ConfigKeySocialTikHubEnabled = "social.tikhub.enabled"
	ConfigKeySocialTikHubBaseURL = "social.tikhub.baseUrl"
	ConfigKeySocialTikHubAPIKey  = "social.tikhub.apiKey"
	DefaultSocialTikHubBaseURL   = "https://api.tikhub.io"
)

// SocialAnalysisConfigKeys are protected baseline keys used by the
// multi-platform content-analysis workbench.
var SocialAnalysisConfigKeys = []string{
	ConfigKeySocialTikHubEnabled,
	ConfigKeySocialTikHubBaseURL,
	ConfigKeySocialTikHubAPIKey,
}

// SocialAnalysisBaselineConfigs seeds the integration without a credential.
// Operators enter the API key in the generic configuration screen.
func SocialAnalysisBaselineConfigs() []SysConfig {
	return []SysConfig{
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

// IsSecretConfigKey reports every sys_config value that must never be exposed
// by the generic admin configuration API.
func IsSecretConfigKey(key string) bool {
	return key == ConfigKeySocialTikHubAPIKey || IsSupplierBalanceSecretConfigKey(key)
}
