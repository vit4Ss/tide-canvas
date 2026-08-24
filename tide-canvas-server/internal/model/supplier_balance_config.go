package model

// Supplier-balance settings live in sys_config so operators can rotate short-
// lived JWTs without changing deployment environment variables or restarting
// the API service. Access-token rows are masked by the admin config API; the
// balance monitor reads their real values directly from the database.

const ConfigGroupSupplierBalances = "供应商余额"

const (
	ConfigKeyBalanceMikotoEnabled     = "balance.mikoto.enabled"
	ConfigKeyBalanceMikotoAccessToken = "balance.mikoto.accessToken"
	ConfigKeyBalanceMikotoLowBalance  = "balance.mikoto.lowBalance"

	ConfigKeyBalanceCCGOEnabled     = "balance.ccgo.enabled"
	ConfigKeyBalanceCCGOAccessToken = "balance.ccgo.accessToken"
	ConfigKeyBalanceCCGOLowBalance  = "balance.ccgo.lowBalance"

	ConfigKeyBalanceCCGO2Enabled     = "balance.ccgo2.enabled"
	ConfigKeyBalanceCCGO2AccessToken = "balance.ccgo2.accessToken"
	ConfigKeyBalanceCCGO2LowBalance  = "balance.ccgo2.lowBalance"

	ConfigKeyBalanceDimensioEnabled     = "balance.dimensio.enabled"
	ConfigKeyBalanceDimensioAccessToken = "balance.dimensio.accessToken"
	ConfigKeyBalanceDimensioLowBalance  = "balance.dimensio.lowBalance"
)

// SupplierBalanceConfigKeys are protected baseline keys in the generic config
// editor: they may be updated but not deleted.
var SupplierBalanceConfigKeys = []string{
	ConfigKeyBalanceMikotoEnabled,
	ConfigKeyBalanceMikotoAccessToken,
	ConfigKeyBalanceMikotoLowBalance,
	ConfigKeyBalanceCCGOEnabled,
	ConfigKeyBalanceCCGOAccessToken,
	ConfigKeyBalanceCCGOLowBalance,
	ConfigKeyBalanceCCGO2Enabled,
	ConfigKeyBalanceCCGO2AccessToken,
	ConfigKeyBalanceCCGO2LowBalance,
	ConfigKeyBalanceDimensioEnabled,
	ConfigKeyBalanceDimensioAccessToken,
	ConfigKeyBalanceDimensioLowBalance,
}

var supplierBalanceSecretKeys = map[string]struct{}{
	ConfigKeyBalanceMikotoAccessToken:   {},
	ConfigKeyBalanceCCGOAccessToken:     {},
	ConfigKeyBalanceCCGO2AccessToken:    {},
	ConfigKeyBalanceDimensioAccessToken: {},
}

// IsSupplierBalanceSecretConfigKey reports whether a sys_config value contains
// a supplier credential and therefore must never be returned in plaintext.
func IsSupplierBalanceSecretConfigKey(key string) bool {
	_, ok := supplierBalanceSecretKeys[key]
	return ok
}

// SupplierBalanceBaselineConfigs returns the rows seeded on boot. Tokens start
// empty intentionally: the operator enters them through 配置管理. Enabled and
// low-balance values are read on every monitor refresh.
func SupplierBalanceBaselineConfigs() []SysConfig {
	return []SysConfig{
		{ConfigKey: ConfigKeyBalanceMikotoEnabled, ConfigValue: "1", Group: ConfigGroupSupplierBalances, Description: "Mikoto 余额监控开关；保存后即时生效"},
		{ConfigKey: ConfigKeyBalanceMikotoAccessToken, ConfigValue: "", Group: ConfigGroupSupplierBalances, Description: "Mikoto 访问令牌（JWT，不含 Bearer；粘贴新值可替换，清空可移除）"},
		{ConfigKey: ConfigKeyBalanceMikotoLowBalance, ConfigValue: "20", Group: ConfigGroupSupplierBalances, Description: "Mikoto 低余额预警线（USD）"},

		{ConfigKey: ConfigKeyBalanceCCGOEnabled, ConfigValue: "1", Group: ConfigGroupSupplierBalances, Description: "CCGO 余额监控开关；保存后即时生效"},
		{ConfigKey: ConfigKeyBalanceCCGOAccessToken, ConfigValue: "", Group: ConfigGroupSupplierBalances, Description: "CCGO 访问令牌（JWT，不含 Bearer；粘贴新值可替换，清空可移除）"},
		{ConfigKey: ConfigKeyBalanceCCGOLowBalance, ConfigValue: "20", Group: ConfigGroupSupplierBalances, Description: "CCGO 低余额预警线（USD）"},

		{ConfigKey: ConfigKeyBalanceCCGO2Enabled, ConfigValue: "1", Group: ConfigGroupSupplierBalances, Description: "CCGO2 余额监控开关；保存后即时生效"},
		{ConfigKey: ConfigKeyBalanceCCGO2AccessToken, ConfigValue: "", Group: ConfigGroupSupplierBalances, Description: "CCGO2 访问令牌（JWT，不含 Bearer；粘贴新值可替换，清空可移除）"},
		{ConfigKey: ConfigKeyBalanceCCGO2LowBalance, ConfigValue: "20", Group: ConfigGroupSupplierBalances, Description: "CCGO2 低余额预警线（USD）"},

		{ConfigKey: ConfigKeyBalanceDimensioEnabled, ConfigValue: "1", Group: ConfigGroupSupplierBalances, Description: "Dimensio 余额监控开关；保存后即时生效"},
		{ConfigKey: ConfigKeyBalanceDimensioAccessToken, ConfigValue: "", Group: ConfigGroupSupplierBalances, Description: "Dimensio 访问令牌（JWT，不含 Bearer；粘贴新值可替换，清空可移除）"},
		{ConfigKey: ConfigKeyBalanceDimensioLowBalance, ConfigValue: "50000", Group: ConfigGroupSupplierBalances, Description: "Dimensio 低余额预警线（积分）"},
	}
}
