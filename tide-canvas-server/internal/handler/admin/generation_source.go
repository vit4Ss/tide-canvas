package admin

import (
	"gorm.io/gorm"
	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/idgen"
)

// Read durable task provenance in one query, including deleted history. Never
// trust a caller-supplied source marker in the upstream request body.
func resolveGenerationAPISources(db *gorm.DB, rows []model.ModelCallLog) (map[idgen.ID]bool, error) {
	out := make(map[idgen.ID]bool)
	ids := make([]idgen.ID, 0, len(rows))
	for _, row := range rows {
		if row.BillingRefType == "task" && row.BillingRefID != 0 {
			ids = append(ids, row.BillingRefID)
		}
	}
	if len(ids) == 0 {
		return out, nil
	}
	var tasks []model.AiTask
	if err := db.Unscoped().Select("id", "user_id", "is_api_call").Where("id IN ?", ids).Find(&tasks).Error; err != nil {
		return nil, err
	}
	byID := make(map[idgen.ID]model.AiTask, len(tasks))
	for _, task := range tasks {
		byID[task.ID] = task
	}
	for _, row := range rows {
		task, ok := byID[row.BillingRefID]
		if ok && row.BillingRefType == "task" && row.UserID == task.UserID {
			out[row.ID] = task.IsAPICall
		}
	}
	return out, nil
}
