package model

// Supplier-balance settings live in sys_config so operators can rotate
// credentials without changing deployment environment variables or restarting
// the API service. Secret rows (passwords, access tokens) are masked by the
// admin config API; the balance monitor reads their real values directly from
// the database. When a supplier account (email/username + password) is
// configured, the monitor logs in on its own and renews the session JWT
// automatically — the access-token row then becomes an optional manual
// fallback.

const ConfigGroupSupplierBalances = "供应商余额"

const (
	// DLAPI is a New API panel; its sk- account token never expires.
	ConfigKeyBalanceDLAPIEnabled     = "balance.dlapi.enabled"
	ConfigKeyBalanceDLAPIUserID      = "balance.dlapi.userId"
	ConfigKeyBalanceDLAPIAccessToken = "balance.dlapi.accessToken"
	ConfigKeyBalanceDLAPILowBalance  = "balance.dlapi.lowBalance"

	ConfigKeyBalanceMikotoEnabled     = "balance.mikoto.enabled"
	ConfigKeyBalanceMikotoEmail       = "balance.mikoto.email"
	ConfigKeyBalanceMikotoPassword    = "balance.mikoto.password"
	ConfigKeyBalanceMikotoAccessToken = "balance.mikoto.accessToken"
	ConfigKeyBalanceMikotoLowBalance  = "balance.mikoto.lowBalance"

	ConfigKeyBalanceCCGOEnabled     = "balance.ccgo.enabled"
	ConfigKeyBalanceCCGOEmail       = "balance.ccgo.email"
	ConfigKeyBalanceCCGOPassword    = "balance.ccgo.password"
	ConfigKeyBalanceCCGOAccessToken = "balance.ccgo.accessToken"
	ConfigKeyBalanceCCGOLowBalance  = "balance.ccgo.lowBalance"

	ConfigKeyBalanceCCGO2Enabled     = "balance.ccgo2.enabled"
	ConfigKeyBalanceCCGO2Email       = "balance.ccgo2.email"
	ConfigKeyBalanceCCGO2Password    = "balance.ccgo2.password"
	ConfigKeyBalanceCCGO2AccessToken = "balance.ccgo2.accessToken"
	ConfigKeyBalanceCCGO2LowBalance  = "balance.ccgo2.lowBalance"

	ConfigKeyBalanceDimensioEnabled     = "balance.dimensio.enabled"
	ConfigKeyBalanceDimensioUsername    = "balance.dimensio.username"
	ConfigKeyBalanceDimensioPassword    = "balance.dimensio.password"
	ConfigKeyBalanceDimensioAccessToken = "balance.dimensio.accessToken"
	ConfigKeyBalanceDimensioLowBalance  = "balance.dimensio.lowBalance"

	// Uniart is a New API panel: its system access token never expires, so no
	// login credentials are needed — token plus the numeric user id suffice.
	ConfigKeyBalanceUniartEnabled     = "balance.uniart.enabled"
	ConfigKeyBalanceUniartUserID      = "balance.uniart.userId"
	ConfigKeyBalanceUniartAccessToken = "balance.uniart.accessToken"
	ConfigKeyBalanceUniartLowBalance  = "balance.uniart.lowBalance"

	// Wxart is a one-api panel (quota_per_unit 100, shown as "R"): the system
	// access token never expires and no New-Api-User header is required.
	ConfigKeyBalanceWxartEnabled     = "balance.wxart.enabled"
	ConfigKeyBalanceWxartUserID      = "balance.wxart.userId"
	ConfigKeyBalanceWxartAccessToken = "balance.wxart.accessToken"
	ConfigKeyBalanceWxartLowBalance  = "balance.wxart.lowBalance"

	// secure-skill runs the same platform software as Mikoto/CCGO: session
	// JWTs via email+password auto-login, manual token as fallback.
	ConfigKeyBalanceSecureSkillEnabled     = "balance.secureskill.enabled"
	ConfigKeyBalanceSecureSkillEmail       = "balance.secureskill.email"
	ConfigKeyBalanceSecureSkillPassword    = "balance.secureskill.password"
	ConfigKeyBalanceSecureSkillAccessToken = "balance.secureskill.accessToken"
	ConfigKeyBalanceSecureSkillLowBalance  = "balance.secureskill.lowBalance"
)

// SupplierBalanceConfigKeys are protected baseline keys in the generic config
// editor: they may be updated but not deleted.
var SupplierBalanceConfigKeys = []string{
	ConfigKeyBalanceDLAPIEnabled,
	ConfigKeyBalanceDLAPIUserID,
	ConfigKeyBalanceDLAPIAccessToken,
	ConfigKeyBalanceDLAPILowBalance,
	ConfigKeyBalanceMikotoEnabled,
	ConfigKeyBalanceMikotoEmail,
	ConfigKeyBalanceMikotoPassword,
	ConfigKeyBalanceMikotoAccessToken,
	ConfigKeyBalanceMikotoLowBalance,
	ConfigKeyBalanceCCGOEnabled,
	ConfigKeyBalanceCCGOEmail,
	ConfigKeyBalanceCCGOPassword,
	ConfigKeyBalanceCCGOAccessToken,
	ConfigKeyBalanceCCGOLowBalance,
	ConfigKeyBalanceCCGO2Enabled,
	ConfigKeyBalanceCCGO2Email,
	ConfigKeyBalanceCCGO2Password,
	ConfigKeyBalanceCCGO2AccessToken,
	ConfigKeyBalanceCCGO2LowBalance,
	ConfigKeyBalanceDimensioEnabled,
	ConfigKeyBalanceDimensioUsername,
	ConfigKeyBalanceDimensioPassword,
	ConfigKeyBalanceDimensioAccessToken,
	ConfigKeyBalanceDimensioLowBalance,
	ConfigKeyBalanceUniartEnabled,
	ConfigKeyBalanceUniartUserID,
	ConfigKeyBalanceUniartAccessToken,
	ConfigKeyBalanceUniartLowBalance,
	ConfigKeyBalanceWxartEnabled,
	ConfigKeyBalanceWxartUserID,
	ConfigKeyBalanceWxartAccessToken,
	ConfigKeyBalanceWxartLowBalance,
	ConfigKeyBalanceSecureSkillEnabled,
	ConfigKeyBalanceSecureSkillEmail,
	ConfigKeyBalanceSecureSkillPassword,
	ConfigKeyBalanceSecureSkillAccessToken,
	ConfigKeyBalanceSecureSkillLowBalance,
}

var supplierBalanceSecretKeys = map[string]struct{}{
	ConfigKeyBalanceDLAPIAccessToken:       {},
	ConfigKeyBalanceMikotoPassword:         {},
	ConfigKeyBalanceMikotoAccessToken:      {},
	ConfigKeyBalanceCCGOPassword:           {},
	ConfigKeyBalanceCCGOAccessToken:        {},
	ConfigKeyBalanceCCGO2Password:          {},
	ConfigKeyBalanceCCGO2AccessToken:       {},
	ConfigKeyBalanceDimensioPassword:       {},
	ConfigKeyBalanceDimensioAccessToken:    {},
	ConfigKeyBalanceUniartAccessToken:      {},
	ConfigKeyBalanceWxartAccessToken:       {},
	ConfigKeyBalanceSecureSkillPassword:    {},
	ConfigKeyBalanceSecureSkillAccessToken: {},
}

// IsSupplierBalanceSecretConfigKey reports whether a sys_config value contains
// a supplier credential and therefore must never be returned in plaintext.
func IsSupplierBalanceSecretConfigKey(key string) bool {
	_, ok := supplierBalanceSecretKeys[key]
	return ok
}

// SupplierBalanceBaselineConfigs returns the rows seeded on boot. Credentials
// start empty intentionally: the operator enters them through 配置管理. All
// values are read on every monitor refresh.
func SupplierBalanceBaselineConfigs() []SysConfig {
	return []SysConfig{
		{ConfigKey: ConfigKeyBalanceDLAPIEnabled, ConfigValue: "1", Group: ConfigGroupSupplierBalances, Description: "DLAPI 余额监控开关；保存后即时生效"},
		{ConfigKey: ConfigKeyBalanceDLAPIUserID, ConfigValue: "245", Group: ConfigGroupSupplierBalances, Description: "DLAPI 用户 ID（数字，控制台个人设置里可查看，随访问令牌一起校验）"},
		{ConfigKey: ConfigKeyBalanceDLAPIAccessToken, ConfigValue: "", Group: ConfigGroupSupplierBalances, Description: "DLAPI 系统访问令牌（sk- 开头原样粘贴，控制台生成，长期有效，无需账号密码）"},
		{ConfigKey: ConfigKeyBalanceDLAPILowBalance, ConfigValue: "20", Group: ConfigGroupSupplierBalances, Description: "DLAPI 低余额预警线（USD）"},

		{ConfigKey: ConfigKeyBalanceMikotoEnabled, ConfigValue: "1", Group: ConfigGroupSupplierBalances, Description: "Mikoto 余额监控开关；保存后即时生效"},
		{ConfigKey: ConfigKeyBalanceMikotoEmail, ConfigValue: "", Group: ConfigGroupSupplierBalances, Description: "Mikoto 登录邮箱；与登录密码一起填写后自动登录续期，无需再手动粘贴 JWT"},
		{ConfigKey: ConfigKeyBalanceMikotoPassword, ConfigValue: "", Group: ConfigGroupSupplierBalances, Description: "Mikoto 登录密码；保存后脱敏显示，清空可移除"},
		{ConfigKey: ConfigKeyBalanceMikotoAccessToken, ConfigValue: "", Group: ConfigGroupSupplierBalances, Description: "Mikoto 访问令牌（JWT，不含 Bearer；已配置账号密码时留空即可，仅作手动兜底）"},
		{ConfigKey: ConfigKeyBalanceMikotoLowBalance, ConfigValue: "20", Group: ConfigGroupSupplierBalances, Description: "Mikoto 低余额预警线（USD）"},

		{ConfigKey: ConfigKeyBalanceCCGOEnabled, ConfigValue: "1", Group: ConfigGroupSupplierBalances, Description: "CCGO 余额监控开关；保存后即时生效"},
		{ConfigKey: ConfigKeyBalanceCCGOEmail, ConfigValue: "", Group: ConfigGroupSupplierBalances, Description: "CCGO 登录邮箱；与登录密码一起填写后自动登录续期，无需再手动粘贴 JWT"},
		{ConfigKey: ConfigKeyBalanceCCGOPassword, ConfigValue: "", Group: ConfigGroupSupplierBalances, Description: "CCGO 登录密码；保存后脱敏显示，清空可移除"},
		{ConfigKey: ConfigKeyBalanceCCGOAccessToken, ConfigValue: "", Group: ConfigGroupSupplierBalances, Description: "CCGO 访问令牌（JWT，不含 Bearer；已配置账号密码时留空即可，仅作手动兜底）"},
		{ConfigKey: ConfigKeyBalanceCCGOLowBalance, ConfigValue: "20", Group: ConfigGroupSupplierBalances, Description: "CCGO 低余额预警线（USD）"},

		{ConfigKey: ConfigKeyBalanceCCGO2Enabled, ConfigValue: "1", Group: ConfigGroupSupplierBalances, Description: "CCGO2 余额监控开关；保存后即时生效"},
		{ConfigKey: ConfigKeyBalanceCCGO2Email, ConfigValue: "", Group: ConfigGroupSupplierBalances, Description: "CCGO2 登录邮箱；与登录密码一起填写后自动登录续期，无需再手动粘贴 JWT"},
		{ConfigKey: ConfigKeyBalanceCCGO2Password, ConfigValue: "", Group: ConfigGroupSupplierBalances, Description: "CCGO2 登录密码；保存后脱敏显示，清空可移除"},
		{ConfigKey: ConfigKeyBalanceCCGO2AccessToken, ConfigValue: "", Group: ConfigGroupSupplierBalances, Description: "CCGO2 访问令牌（JWT，不含 Bearer；已配置账号密码时留空即可，仅作手动兜底）"},
		{ConfigKey: ConfigKeyBalanceCCGO2LowBalance, ConfigValue: "20", Group: ConfigGroupSupplierBalances, Description: "CCGO2 低余额预警线（USD）"},

		{ConfigKey: ConfigKeyBalanceDimensioEnabled, ConfigValue: "1", Group: ConfigGroupSupplierBalances, Description: "Dimensio 余额监控开关；保存后即时生效"},
		{ConfigKey: ConfigKeyBalanceDimensioUsername, ConfigValue: "", Group: ConfigGroupSupplierBalances, Description: "Dimensio 登录用户名；与登录密码一起填写后自动登录续期，无需再手动粘贴 JWT"},
		{ConfigKey: ConfigKeyBalanceDimensioPassword, ConfigValue: "", Group: ConfigGroupSupplierBalances, Description: "Dimensio 登录密码；保存后脱敏显示，清空可移除"},
		{ConfigKey: ConfigKeyBalanceDimensioAccessToken, ConfigValue: "", Group: ConfigGroupSupplierBalances, Description: "Dimensio 访问令牌（JWT，不含 Bearer；已配置账号密码时留空即可，仅作手动兜底）"},
		{ConfigKey: ConfigKeyBalanceDimensioLowBalance, ConfigValue: "50000", Group: ConfigGroupSupplierBalances, Description: "Dimensio 低余额预警线（积分）"},

		{ConfigKey: ConfigKeyBalanceUniartEnabled, ConfigValue: "1", Group: ConfigGroupSupplierBalances, Description: "Uniart 余额监控开关；保存后即时生效"},
		{ConfigKey: ConfigKeyBalanceUniartUserID, ConfigValue: "", Group: ConfigGroupSupplierBalances, Description: "Uniart 用户 ID（必填，数字，控制台个人设置里可查看，随访问令牌一起校验）"},
		{ConfigKey: ConfigKeyBalanceUniartAccessToken, ConfigValue: "", Group: ConfigGroupSupplierBalances, Description: "Uniart 系统访问令牌（控制台「个人设置 → 系统访问令牌」生成，长期有效，无需账号密码）"},
		{ConfigKey: ConfigKeyBalanceUniartLowBalance, ConfigValue: "100", Group: ConfigGroupSupplierBalances, Description: "Uniart 低余额预警线（USD，面板额度按 500000 quota = 1 折算）"},

		{ConfigKey: ConfigKeyBalanceWxartEnabled, ConfigValue: "1", Group: ConfigGroupSupplierBalances, Description: "wxart 余额监控开关；保存后即时生效"},
		{ConfigKey: ConfigKeyBalanceWxartUserID, ConfigValue: "", Group: ConfigGroupSupplierBalances, Description: "wxart 用户 ID（可留空；one-api 面板通常不校验，面板要求时再填写）"},
		{ConfigKey: ConfigKeyBalanceWxartAccessToken, ConfigValue: "", Group: ConfigGroupSupplierBalances, Description: "wxart 系统访问令牌（控制台「个人设置 → 生成访问令牌」，长期有效，无需账号密码）"},
		{ConfigKey: ConfigKeyBalanceWxartLowBalance, ConfigValue: "50", Group: ConfigGroupSupplierBalances, Description: "wxart 低余额预警线（R，面板额度按 100 quota = 1 R 折算）"},

		{ConfigKey: ConfigKeyBalanceSecureSkillEnabled, ConfigValue: "1", Group: ConfigGroupSupplierBalances, Description: "secure-skill 余额监控开关；保存后即时生效"},
		{ConfigKey: ConfigKeyBalanceSecureSkillEmail, ConfigValue: "", Group: ConfigGroupSupplierBalances, Description: "secure-skill 登录邮箱；与登录密码一起填写后自动登录续期，无需再手动粘贴 JWT"},
		{ConfigKey: ConfigKeyBalanceSecureSkillPassword, ConfigValue: "", Group: ConfigGroupSupplierBalances, Description: "secure-skill 登录密码；保存后脱敏显示，清空可移除"},
		{ConfigKey: ConfigKeyBalanceSecureSkillAccessToken, ConfigValue: "", Group: ConfigGroupSupplierBalances, Description: "secure-skill 访问令牌（JWT，不含 Bearer；已配置账号密码时留空即可，仅作手动兜底）"},
		{ConfigKey: ConfigKeyBalanceSecureSkillLowBalance, ConfigValue: "20", Group: ConfigGroupSupplierBalances, Description: "secure-skill 低余额预警线（USD）"},
	}
}
