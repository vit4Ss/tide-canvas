package admin

import "gorm.io/gorm"

// adminCreateRow creates row, force-writes forcedCols in the same transaction,
// then reloads the row from the DB so the echoed VO is the persisted truth
// (decimal precision rounding, DB defaults) instead of the pre-persistence
// in-memory object.
//
// The forced write exists because GORM's struct Create silently skips zero
// values (false / 0) on columns carrying a `default` tag: a create with
// enabled:false or status:0 would otherwise land as the DB default (true / 1),
// putting e.g. a draft plan straight onto the public pricing page. Same
// workaround as model.ensureBaselineTools uses for seeding.
func adminCreateRow(db *gorm.DB, row any, forcedCols map[string]any) error {
	if err := db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(row).Error; err != nil {
			return err
		}
		if len(forcedCols) == 0 {
			return nil
		}
		return tx.Model(row).UpdateColumns(forcedCols).Error
	}); err != nil {
		return err
	}
	return db.First(row).Error
}
