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
	// DLAPI is a New API panel. Username+password auto-login is the primary
	// integration (the console rejects relay sk- API keys); the access-token
	// row accepts a console-generated system access token as manual fallback.
	ConfigKeyBalanceDLAPIEnabled      = "balance.dlapi.enabled"
	ConfigKeyBalanceDLAPIUserID       = "balance.dlapi.userId"
	ConfigKeyBalanceDLAPIUsername     = "balance.dlapi.username"
	ConfigKeyBalanceDLAPIPassword     = "balance.dlapi.password"
	ConfigKeyBalanceDLAPIAccessToken  = "balance.dlapi.accessToken"
	ConfigKeyBalanceDLAPICurrency     = "balance.dlapi.currency"
	ConfigKeyBalanceDLAPIExchangeRate = "balance.dlapi.exchangeRate"
	ConfigKeyBalanceDLAPILowBalance   = "balance.dlapi.lowBalance"

	ConfigKeyBalanceMikotoEnabled      = "balance.mikoto.enabled"
	ConfigKeyBalanceMikotoEmail        = "balance.mikoto.email"
	ConfigKeyBalanceMikotoPassword     = "balance.mikoto.password"
	ConfigKeyBalanceMikotoAccessToken  = "balance.mikoto.accessToken"
	ConfigKeyBalanceMikotoCurrency     = "balance.mikoto.currency"
	ConfigKeyBalanceMikotoExchangeRate = "balance.mikoto.exchangeRate"
	ConfigKeyBalanceMikotoLowBalance   = "balance.mikoto.lowBalance"

	ConfigKeyBalanceCCGOEnabled      = "balance.ccgo.enabled"
	ConfigKeyBalanceCCGOEmail        = "balance.ccgo.email"
	ConfigKeyBalanceCCGOPassword     = "balance.ccgo.password"
	ConfigKeyBalanceCCGOAccessToken  = "balance.ccgo.accessToken"
	ConfigKeyBalanceCCGOCurrency     = "balance.ccgo.currency"
	ConfigKeyBalanceCCGOExchangeRate = "balance.ccgo.exchangeRate"
	ConfigKeyBalanceCCGOLowBalance   = "balance.ccgo.lowBalance"

	ConfigKeyBalanceCCGO2Enabled      = "balance.ccgo2.enabled"
	ConfigKeyBalanceCCGO2Email        = "balance.ccgo2.email"
	ConfigKeyBalanceCCGO2Password     = "balance.ccgo2.password"
	ConfigKeyBalanceCCGO2AccessToken  = "balance.ccgo2.accessToken"
	ConfigKeyBalanceCCGO2Currency     = "balance.ccgo2.currency"
	ConfigKeyBalanceCCGO2ExchangeRate = "balance.ccgo2.exchangeRate"
	ConfigKeyBalanceCCGO2LowBalance   = "balance.ccgo2.lowBalance"

	ConfigKeyBalanceDimensioEnabled     = "balance.dimensio.enabled"
	ConfigKeyBalanceDimensioUsername    = "balance.dimensio.username"
	ConfigKeyBalanceDimensioPassword    = "balance.dimensio.password"
	ConfigKeyBalanceDimensioAccessToken = "balance.dimensio.accessToken"
	ConfigKeyBalanceDimensioLowBalance  = "balance.dimensio.lowBalance"

	// Uniart is a New API panel. With username+password configured the monitor
	// logs in via POST /api/user/login and keeps the session cookie fresh; the
	// system access token remains a manual fallback.
	ConfigKeyBalanceUniartEnabled      = "balance.uniart.enabled"
	ConfigKeyBalanceUniartUserID       = "balance.uniart.userId"
	ConfigKeyBalanceUniartUsername     = "balance.uniart.username"
	ConfigKeyBalanceUniartPassword     = "balance.uniart.password"
	ConfigKeyBalanceUniartAccessToken  = "balance.uniart.accessToken"
	ConfigKeyBalanceUniartCurrency     = "balance.uniart.currency"
	ConfigKeyBalanceUniartExchangeRate = "balance.uniart.exchangeRate"
	ConfigKeyBalanceUniartLowBalance   = "balance.uniart.lowBalance"

	// Wxart runs a custom "x deal" console that mimics the New API surface
	// (quota_per_unit 100, shown as "R"). Its web console is cookie-session
	// only, so username+password auto-login is the primary integration; the
	// access-token row is kept in case its API-key auth starts working.
	ConfigKeyBalanceWxartEnabled      = "balance.wxart.enabled"
	ConfigKeyBalanceWxartUserID       = "balance.wxart.userId"
	ConfigKeyBalanceWxartUsername     = "balance.wxart.username"
	ConfigKeyBalanceWxartPassword     = "balance.wxart.password"
	ConfigKeyBalanceWxartAccessToken  = "balance.wxart.accessToken"
	ConfigKeyBalanceWxartCurrency     = "balance.wxart.currency"
	ConfigKeyBalanceWxartExchangeRate = "balance.wxart.exchangeRate"
	ConfigKeyBalanceWxartLowBalance   = "balance.wxart.lowBalance"

	// secure-skill runs the same platform software as Mikoto/CCGO: session
	// JWTs via email+password auto-login, manual token as fallback.
	ConfigKeyBalanceSecureSkillEnabled      = "balance.secureskill.enabled"
	ConfigKeyBalanceSecureSkillEmail        = "balance.secureskill.email"
	ConfigKeyBalanceSecureSkillPassword     = "balance.secureskill.password"
	ConfigKeyBalanceSecureSkillAccessToken  = "balance.secureskill.accessToken"
	ConfigKeyBalanceSecureSkillCurrency     = "balance.secureskill.currency"
	ConfigKeyBalanceSecureSkillExchangeRate = "balance.secureskill.exchangeRate"
	ConfigKeyBalanceSecureSkillLowBalance   = "balance.secureskill.lowBalance"

	// APIYI is a standard New API panel with a documented balance endpoint
	// (GET /api/user/self, quota/500000 = USD). Its console-generated system
	// token is long-lived, so the token is the primary integration;
	// username+password auto-login works as well.
	ConfigKeyBalanceAPIYIEnabled      = "balance.apiyi.enabled"
	ConfigKeyBalanceAPIYIUserID       = "balance.apiyi.userId"
	ConfigKeyBalanceAPIYIUsername     = "balance.apiyi.username"
	ConfigKeyBalanceAPIYIPassword     = "balance.apiyi.password"
	ConfigKeyBalanceAPIYIAccessToken  = "balance.apiyi.accessToken"
	ConfigKeyBalanceAPIYICurrency     = "balance.apiyi.currency"
	ConfigKeyBalanceAPIYIExchangeRate = "balance.apiyi.exchangeRate"
	ConfigKeyBalanceAPIYILowBalance   = "balance.apiyi.lowBalance"
)

// SupplierBalanceConfigKeys are protected baseline keys in the generic config
// editor: they may be updated but not deleted.
var SupplierBalanceConfigKeys = []string{
	ConfigKeyBalanceDLAPIEnabled,
	ConfigKeyBalanceDLAPIUserID,
	ConfigKeyBalanceDLAPIUsername,
	ConfigKeyBalanceDLAPIPassword,
	ConfigKeyBalanceDLAPIAccessToken,
	ConfigKeyBalanceDLAPICurrency,
	ConfigKeyBalanceDLAPIExchangeRate,
	ConfigKeyBalanceDLAPILowBalance,
	ConfigKeyBalanceMikotoEnabled,
	ConfigKeyBalanceMikotoEmail,
	ConfigKeyBalanceMikotoPassword,
	ConfigKeyBalanceMikotoAccessToken,
	ConfigKeyBalanceMikotoCurrency,
	ConfigKeyBalanceMikotoExchangeRate,
	ConfigKeyBalanceMikotoLowBalance,
	ConfigKeyBalanceCCGOEnabled,
	ConfigKeyBalanceCCGOEmail,
	ConfigKeyBalanceCCGOPassword,
	ConfigKeyBalanceCCGOAccessToken,
	ConfigKeyBalanceCCGOCurrency,
	ConfigKeyBalanceCCGOExchangeRate,
	ConfigKeyBalanceCCGOLowBalance,
	ConfigKeyBalanceCCGO2Enabled,
	ConfigKeyBalanceCCGO2Email,
	ConfigKeyBalanceCCGO2Password,
	ConfigKeyBalanceCCGO2AccessToken,
	ConfigKeyBalanceCCGO2Currency,
	ConfigKeyBalanceCCGO2ExchangeRate,
	ConfigKeyBalanceCCGO2LowBalance,
	ConfigKeyBalanceDimensioEnabled,
	ConfigKeyBalanceDimensioUsername,
	ConfigKeyBalanceDimensioPassword,
	ConfigKeyBalanceDimensioAccessToken,
	ConfigKeyBalanceDimensioLowBalance,
	ConfigKeyBalanceUniartEnabled,
	ConfigKeyBalanceUniartUserID,
	ConfigKeyBalanceUniartUsername,
	ConfigKeyBalanceUniartPassword,
	ConfigKeyBalanceUniartAccessToken,
	ConfigKeyBalanceUniartCurrency,
	ConfigKeyBalanceUniartExchangeRate,
	ConfigKeyBalanceUniartLowBalance,
	ConfigKeyBalanceWxartEnabled,
	ConfigKeyBalanceWxartUserID,
	ConfigKeyBalanceWxartUsername,
	ConfigKeyBalanceWxartPassword,
	ConfigKeyBalanceWxartAccessToken,
	ConfigKeyBalanceWxartCurrency,
	ConfigKeyBalanceWxartExchangeRate,
	ConfigKeyBalanceWxartLowBalance,
	ConfigKeyBalanceSecureSkillEnabled,
	ConfigKeyBalanceSecureSkillEmail,
	ConfigKeyBalanceSecureSkillPassword,
	ConfigKeyBalanceSecureSkillAccessToken,
	ConfigKeyBalanceSecureSkillCurrency,
	ConfigKeyBalanceSecureSkillExchangeRate,
	ConfigKeyBalanceSecureSkillLowBalance,
	ConfigKeyBalanceAPIYIEnabled,
	ConfigKeyBalanceAPIYIUserID,
	ConfigKeyBalanceAPIYIUsername,
	ConfigKeyBalanceAPIYIPassword,
	ConfigKeyBalanceAPIYIAccessToken,
	ConfigKeyBalanceAPIYICurrency,
	ConfigKeyBalanceAPIYIExchangeRate,
	ConfigKeyBalanceAPIYILowBalance,
}

var supplierBalanceSecretKeys = map[string]struct{}{
	ConfigKeyBalanceDLAPIPassword:          {},
	ConfigKeyBalanceDLAPIAccessToken:       {},
	ConfigKeyBalanceMikotoPassword:         {},
	ConfigKeyBalanceMikotoAccessToken:      {},
	ConfigKeyBalanceCCGOPassword:           {},
	ConfigKeyBalanceCCGOAccessToken:        {},
	ConfigKeyBalanceCCGO2Password:          {},
	ConfigKeyBalanceCCGO2AccessToken:       {},
	ConfigKeyBalanceDimensioPassword:       {},
	ConfigKeyBalanceDimensioAccessToken:    {},
	ConfigKeyBalanceUniartPassword:         {},
	ConfigKeyBalanceUniartAccessToken:      {},
	ConfigKeyBalanceWxartPassword:          {},
	ConfigKeyBalanceWxartAccessToken:       {},
	ConfigKeyBalanceSecureSkillPassword:    {},
	ConfigKeyBalanceSecureSkillAccessToken: {},
	ConfigKeyBalanceAPIYIPassword:          {},
	ConfigKeyBalanceAPIYIAccessToken:       {},
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
		{ConfigKey: ConfigKeyBalanceDLAPIUserID, ConfigValue: "245", Group: ConfigGroupSupplierBalances, Description: "DLAPI 用户 ID（数字；已配置账号密码时可留空，自动取登录返回的 ID）"},
		{ConfigKey: ConfigKeyBalanceDLAPIUsername, ConfigValue: "", Group: ConfigGroupSupplierBalances, Description: "DLAPI 登录用户名；与登录密码一起填写后自动登录续期，无需再维护访问令牌"},
		{ConfigKey: ConfigKeyBalanceDLAPIPassword, ConfigValue: "", Group: ConfigGroupSupplierBalances, Description: "DLAPI 登录密码；保存后脱敏显示，清空可移除"},
		{ConfigKey: ConfigKeyBalanceDLAPIAccessToken, ConfigValue: "", Group: ConfigGroupSupplierBalances, Description: "DLAPI 系统访问令牌（控制台个人设置生成，手动兜底；调生图的 sk- API Key 无效）"},
		{ConfigKey: ConfigKeyBalanceDLAPICurrency, ConfigValue: "CNY", Group: ConfigGroupSupplierBalances, Description: "DLAPI 原始计价单位：CNY 或 USD；余额和预警线统一按人民币展示"},
		{ConfigKey: ConfigKeyBalanceDLAPIExchangeRate, ConfigValue: "1", Group: ConfigGroupSupplierBalances, Description: "人民币换算汇率：CNY 填 1，USD 填 1 美元对应的人民币"},
		{ConfigKey: ConfigKeyBalanceDLAPILowBalance, ConfigValue: "20", Group: ConfigGroupSupplierBalances, Description: "DLAPI 人民币低余额预警线"},

		{ConfigKey: ConfigKeyBalanceMikotoEnabled, ConfigValue: "1", Group: ConfigGroupSupplierBalances, Description: "Mikoto 余额监控开关；保存后即时生效"},
		{ConfigKey: ConfigKeyBalanceMikotoEmail, ConfigValue: "", Group: ConfigGroupSupplierBalances, Description: "Mikoto 登录邮箱；与登录密码一起填写后自动登录续期，无需再手动粘贴 JWT"},
		{ConfigKey: ConfigKeyBalanceMikotoPassword, ConfigValue: "", Group: ConfigGroupSupplierBalances, Description: "Mikoto 登录密码；保存后脱敏显示，清空可移除"},
		{ConfigKey: ConfigKeyBalanceMikotoAccessToken, ConfigValue: "", Group: ConfigGroupSupplierBalances, Description: "Mikoto 访问令牌（JWT，不含 Bearer；已配置账号密码时留空即可，仅作手动兜底）"},
		{ConfigKey: ConfigKeyBalanceMikotoCurrency, ConfigValue: "CNY", Group: ConfigGroupSupplierBalances, Description: "Mikoto 原始计价单位：CNY 或 USD；余额和预警线统一按人民币展示"},
		{ConfigKey: ConfigKeyBalanceMikotoExchangeRate, ConfigValue: "1", Group: ConfigGroupSupplierBalances, Description: "人民币换算汇率：CNY 填 1，USD 填 1 美元对应的人民币"},
		{ConfigKey: ConfigKeyBalanceMikotoLowBalance, ConfigValue: "20", Group: ConfigGroupSupplierBalances, Description: "Mikoto 人民币低余额预警线"},

		{ConfigKey: ConfigKeyBalanceCCGOEnabled, ConfigValue: "1", Group: ConfigGroupSupplierBalances, Description: "CCGO 余额监控开关；保存后即时生效"},
		{ConfigKey: ConfigKeyBalanceCCGOEmail, ConfigValue: "", Group: ConfigGroupSupplierBalances, Description: "CCGO 登录邮箱；与登录密码一起填写后自动登录续期，无需再手动粘贴 JWT"},
		{ConfigKey: ConfigKeyBalanceCCGOPassword, ConfigValue: "", Group: ConfigGroupSupplierBalances, Description: "CCGO 登录密码；保存后脱敏显示，清空可移除"},
		{ConfigKey: ConfigKeyBalanceCCGOAccessToken, ConfigValue: "", Group: ConfigGroupSupplierBalances, Description: "CCGO 访问令牌（JWT，不含 Bearer；已配置账号密码时留空即可，仅作手动兜底）"},
		{ConfigKey: ConfigKeyBalanceCCGOCurrency, ConfigValue: "CNY", Group: ConfigGroupSupplierBalances, Description: "CCGO 原始计价单位：CNY 或 USD；余额和预警线统一按人民币展示"},
		{ConfigKey: ConfigKeyBalanceCCGOExchangeRate, ConfigValue: "1", Group: ConfigGroupSupplierBalances, Description: "人民币换算汇率：CNY 填 1，USD 填 1 美元对应的人民币"},
		{ConfigKey: ConfigKeyBalanceCCGOLowBalance, ConfigValue: "20", Group: ConfigGroupSupplierBalances, Description: "CCGO 人民币低余额预警线"},

		{ConfigKey: ConfigKeyBalanceCCGO2Enabled, ConfigValue: "1", Group: ConfigGroupSupplierBalances, Description: "CCGO2 余额监控开关；保存后即时生效"},
		{ConfigKey: ConfigKeyBalanceCCGO2Email, ConfigValue: "", Group: ConfigGroupSupplierBalances, Description: "CCGO2 登录邮箱；与登录密码一起填写后自动登录续期，无需再手动粘贴 JWT"},
		{ConfigKey: ConfigKeyBalanceCCGO2Password, ConfigValue: "", Group: ConfigGroupSupplierBalances, Description: "CCGO2 登录密码；保存后脱敏显示，清空可移除"},
		{ConfigKey: ConfigKeyBalanceCCGO2AccessToken, ConfigValue: "", Group: ConfigGroupSupplierBalances, Description: "CCGO2 访问令牌（JWT，不含 Bearer；已配置账号密码时留空即可，仅作手动兜底）"},
		{ConfigKey: ConfigKeyBalanceCCGO2Currency, ConfigValue: "CNY", Group: ConfigGroupSupplierBalances, Description: "CCGO2 原始计价单位：CNY 或 USD；余额和预警线统一按人民币展示"},
		{ConfigKey: ConfigKeyBalanceCCGO2ExchangeRate, ConfigValue: "1", Group: ConfigGroupSupplierBalances, Description: "人民币换算汇率：CNY 填 1，USD 填 1 美元对应的人民币"},
		{ConfigKey: ConfigKeyBalanceCCGO2LowBalance, ConfigValue: "20", Group: ConfigGroupSupplierBalances, Description: "CCGO2 人民币低余额预警线"},

		{ConfigKey: ConfigKeyBalanceDimensioEnabled, ConfigValue: "1", Group: ConfigGroupSupplierBalances, Description: "Dimensio 余额监控开关；保存后即时生效"},
		{ConfigKey: ConfigKeyBalanceDimensioUsername, ConfigValue: "", Group: ConfigGroupSupplierBalances, Description: "Dimensio 登录用户名；与登录密码一起填写后自动登录续期，无需再手动粘贴 JWT"},
		{ConfigKey: ConfigKeyBalanceDimensioPassword, ConfigValue: "", Group: ConfigGroupSupplierBalances, Description: "Dimensio 登录密码；保存后脱敏显示，清空可移除"},
		{ConfigKey: ConfigKeyBalanceDimensioAccessToken, ConfigValue: "", Group: ConfigGroupSupplierBalances, Description: "Dimensio 访问令牌（JWT，不含 Bearer；已配置账号密码时留空即可，仅作手动兜底）"},
		{ConfigKey: ConfigKeyBalanceDimensioLowBalance, ConfigValue: "500", Group: ConfigGroupSupplierBalances, Description: "Dimensio 人民币低余额预警线（固定按 100 积分 = 1 元）"},

		{ConfigKey: ConfigKeyBalanceUniartEnabled, ConfigValue: "1", Group: ConfigGroupSupplierBalances, Description: "Uniart 余额监控开关；保存后即时生效"},
		{ConfigKey: ConfigKeyBalanceUniartUserID, ConfigValue: "", Group: ConfigGroupSupplierBalances, Description: "Uniart 用户 ID（数字；已配置账号密码时可留空，自动取登录返回的 ID）"},
		{ConfigKey: ConfigKeyBalanceUniartUsername, ConfigValue: "", Group: ConfigGroupSupplierBalances, Description: "Uniart 登录用户名；与登录密码一起填写后自动登录续期，无需再维护访问令牌"},
		{ConfigKey: ConfigKeyBalanceUniartPassword, ConfigValue: "", Group: ConfigGroupSupplierBalances, Description: "Uniart 登录密码；保存后脱敏显示，清空可移除"},
		{ConfigKey: ConfigKeyBalanceUniartAccessToken, ConfigValue: "", Group: ConfigGroupSupplierBalances, Description: "Uniart 系统访问令牌（手动兜底；已配置账号密码时留空即可）"},
		{ConfigKey: ConfigKeyBalanceUniartCurrency, ConfigValue: "CNY", Group: ConfigGroupSupplierBalances, Description: "Uniart 原始计价单位：CNY 或 USD；余额和预警线统一按人民币展示"},
		{ConfigKey: ConfigKeyBalanceUniartExchangeRate, ConfigValue: "1", Group: ConfigGroupSupplierBalances, Description: "人民币换算汇率：CNY 填 1，USD 填 1 美元对应的人民币"},
		{ConfigKey: ConfigKeyBalanceUniartLowBalance, ConfigValue: "100", Group: ConfigGroupSupplierBalances, Description: "Uniart 人民币低余额预警线（面板额度按 500000 quota = 1 原始单位折算）"},

		{ConfigKey: ConfigKeyBalanceWxartEnabled, ConfigValue: "1", Group: ConfigGroupSupplierBalances, Description: "wxart 余额监控开关；保存后即时生效"},
		{ConfigKey: ConfigKeyBalanceWxartUserID, ConfigValue: "", Group: ConfigGroupSupplierBalances, Description: "wxart 用户 ID（数字；已配置账号密码时可留空，自动取登录返回的 ID）"},
		{ConfigKey: ConfigKeyBalanceWxartUsername, ConfigValue: "", Group: ConfigGroupSupplierBalances, Description: "wxart 登录用户名；与登录密码一起填写后自动登录续期（该面板控制台只认登录会话）"},
		{ConfigKey: ConfigKeyBalanceWxartPassword, ConfigValue: "", Group: ConfigGroupSupplierBalances, Description: "wxart 登录密码；保存后脱敏显示，清空可移除"},
		{ConfigKey: ConfigKeyBalanceWxartAccessToken, ConfigValue: "", Group: ConfigGroupSupplierBalances, Description: "wxart 访问令牌（手动兜底；该面板控制台以账号密码登录为准）"},
		{ConfigKey: ConfigKeyBalanceWxartCurrency, ConfigValue: "CNY", Group: ConfigGroupSupplierBalances, Description: "wxart 原始计价单位：CNY 或 USD；余额和预警线统一按人民币展示"},
		{ConfigKey: ConfigKeyBalanceWxartExchangeRate, ConfigValue: "1", Group: ConfigGroupSupplierBalances, Description: "人民币换算汇率：CNY 填 1，USD 填 1 美元对应的人民币"},
		{ConfigKey: ConfigKeyBalanceWxartLowBalance, ConfigValue: "50", Group: ConfigGroupSupplierBalances, Description: "wxart 人民币低余额预警线（面板额度按 100 quota = 1 原始单位折算）"},

		{ConfigKey: ConfigKeyBalanceSecureSkillEnabled, ConfigValue: "1", Group: ConfigGroupSupplierBalances, Description: "secure-skill 余额监控开关；保存后即时生效"},
		{ConfigKey: ConfigKeyBalanceSecureSkillEmail, ConfigValue: "", Group: ConfigGroupSupplierBalances, Description: "secure-skill 登录邮箱；与登录密码一起填写后自动登录续期，无需再手动粘贴 JWT"},
		{ConfigKey: ConfigKeyBalanceSecureSkillPassword, ConfigValue: "", Group: ConfigGroupSupplierBalances, Description: "secure-skill 登录密码；保存后脱敏显示，清空可移除"},
		{ConfigKey: ConfigKeyBalanceSecureSkillAccessToken, ConfigValue: "", Group: ConfigGroupSupplierBalances, Description: "secure-skill 访问令牌（JWT，不含 Bearer；已配置账号密码时留空即可，仅作手动兜底）"},
		{ConfigKey: ConfigKeyBalanceSecureSkillCurrency, ConfigValue: "CNY", Group: ConfigGroupSupplierBalances, Description: "secure-skill 原始计价单位：CNY 或 USD；余额和预警线统一按人民币展示"},
		{ConfigKey: ConfigKeyBalanceSecureSkillExchangeRate, ConfigValue: "1", Group: ConfigGroupSupplierBalances, Description: "人民币换算汇率：CNY 填 1，USD 填 1 美元对应的人民币"},
		{ConfigKey: ConfigKeyBalanceSecureSkillLowBalance, ConfigValue: "20", Group: ConfigGroupSupplierBalances, Description: "secure-skill 人民币低余额预警线"},

		{ConfigKey: ConfigKeyBalanceAPIYIEnabled, ConfigValue: "1", Group: ConfigGroupSupplierBalances, Description: "APIYI 余额监控开关；保存后即时生效"},
		{ConfigKey: ConfigKeyBalanceAPIYIUserID, ConfigValue: "", Group: ConfigGroupSupplierBalances, Description: "APIYI 用户 ID（可留空；官方余额接口仅凭系统令牌即可查询）"},
		{ConfigKey: ConfigKeyBalanceAPIYIUsername, ConfigValue: "", Group: ConfigGroupSupplierBalances, Description: "APIYI 登录用户名（可选；推荐直接用系统令牌，无需账号密码）"},
		{ConfigKey: ConfigKeyBalanceAPIYIPassword, ConfigValue: "", Group: ConfigGroupSupplierBalances, Description: "APIYI 登录密码（可选；保存后脱敏显示，清空可移除）"},
		{ConfigKey: ConfigKeyBalanceAPIYIAccessToken, ConfigValue: "", Group: ConfigGroupSupplierBalances, Description: "APIYI 系统令牌（控制台「个人中心 → 系统令牌」生成，长期有效，原样粘贴）——推荐方式"},
		{ConfigKey: ConfigKeyBalanceAPIYICurrency, ConfigValue: "USD", Group: ConfigGroupSupplierBalances, Description: "APIYI 原始计价单位：CNY 或 USD；余额和预警线统一按人民币展示"},
		{ConfigKey: ConfigKeyBalanceAPIYIExchangeRate, ConfigValue: "7.2", Group: ConfigGroupSupplierBalances, Description: "APIYI 人民币换算汇率：1 美元对应的人民币，可按实际汇率调整"},
		{ConfigKey: ConfigKeyBalanceAPIYILowBalance, ConfigValue: "144", Group: ConfigGroupSupplierBalances, Description: "APIYI 人民币低余额预警线（面板额度按 500000 quota = 1 美元折算）"},
	}
}
