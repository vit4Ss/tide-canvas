package model

import (
	"errors"
	"strconv"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// supplierBalanceCurrencyMigrationKey is an internal, one-time marker. The
// first version of the balance monitor stored lowBalance in each supplier's
// native unit; the current contract stores it in CNY. Existing installations
// need their old thresholds converted exactly once before the new currency
// rows are seeded.
const supplierBalanceCurrencyMigrationKey = "balance.currencyMigration.v1"

func migrateSupplierBalanceCurrency(db *gorm.DB) error {
	return db.Transaction(func(tx *gorm.DB) error {
		// Claim the migration inside the same transaction as the conversion.
		// ON CONFLICT serializes concurrent service instances; rollback removes
		// the claim if any conversion fails, so the next boot can retry safely.
		claim := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&SysConfig{
			ConfigKey:   supplierBalanceCurrencyMigrationKey,
			ConfigValue: "done",
			Group:       ConfigGroupInternal,
			Description: "将供应商余额预警线迁移为人民币口径",
		})
		if claim.Error != nil {
			return claim.Error
		}
		if claim.RowsAffected == 0 {
			return nil
		}

		// If any new currency row already exists, this is a partially
		// upgraded database. Do not guess whether its existing thresholds
		// are native or CNY values.
		currencyKeys := []string{
			ConfigKeyBalanceDLAPICurrency,
			ConfigKeyBalanceMikotoCurrency,
			ConfigKeyBalanceCCGOCurrency,
			ConfigKeyBalanceCCGO2Currency,
			ConfigKeyBalanceUniartCurrency,
			ConfigKeyBalanceWxartCurrency,
			ConfigKeyBalanceSecureSkillCurrency,
			ConfigKeyBalanceAPIYICurrency,
		}
		var configured int64
		if err := tx.Model(&SysConfig{}).Where("config_key IN ?", currencyKeys).Count(&configured).Error; err != nil {
			return err
		}
		if configured > 0 {
			return nil
		}

		// Native threshold -> CNY conversion used by the old seeded rows:
		// APIYI uses the initial USD rate 7.2, wxart's R is RMB, Dimensio's
		// points are worth 0.01 RMB each, and the other providers were only
		// mislabelled as USD—their numeric values were already RMB.
		conversions := []struct {
			key    string
			factor float64
		}{
			// These providers were labelled USD by mistake, but their
			// returned values and operator thresholds were already RMB.
			{ConfigKeyBalanceDLAPILowBalance, 1},
			{ConfigKeyBalanceMikotoLowBalance, 1},
			{ConfigKeyBalanceCCGOLowBalance, 1},
			{ConfigKeyBalanceCCGO2LowBalance, 1},
			{ConfigKeyBalanceDimensioLowBalance, 0.01},
			{ConfigKeyBalanceUniartLowBalance, 1},
			{ConfigKeyBalanceWxartLowBalance, 1},
			{ConfigKeyBalanceSecureSkillLowBalance, 1},
			// APIYI is genuinely USD-denominated.
			{ConfigKeyBalanceAPIYILowBalance, 7.2},
		}
		for _, item := range conversions {
			var row SysConfig
			err := tx.Where("config_key = ?", item.key).First(&row).Error
			if errors.Is(err, gorm.ErrRecordNotFound) {
				continue
			}
			if err != nil {
				return err
			}
			value, err := strconv.ParseFloat(row.ConfigValue, 64)
			if err != nil || value < 0 {
				// Leave malformed values untouched so the existing admin
				// validation still reports them clearly.
				continue
			}
			row.ConfigValue = strconv.FormatFloat(value*item.factor, 'f', -1, 64)
			if err := tx.Model(&SysConfig{}).Where("id = ?", row.ID).
				Update("config_value", row.ConfigValue).Error; err != nil {
				return err
			}
		}
		return nil
	})
}
