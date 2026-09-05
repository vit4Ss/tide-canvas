package points

import (
	"crypto/sha256"
	"errors"
	"fmt"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/idgen"
)

var ErrSocialRequest = errors.New("请求标识已用于其他操作，请重新发起")
var ErrSocialUnavailable = errors.New("本次执行已结束或已退款，请重新发起")
var ErrSocialPriceChanged = errors.New("单次积分价格已更新，请确认页面新价格后重试；本次未扣费")

func SocialPrice(db *gorm.DB, activityType string) (int, error) {
	key := model.ConfigKeySocialAnalysisCost
	if activityType == model.SocialActivityDownload {
		key = model.ConfigKeySocialDownloadCost
	}
	var cfg model.SysConfig
	err := db.Where("config_key = ?", key).First(&cfg).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return 1, nil
	}
	if err != nil {
		return 0, err
	}
	n, ok := model.ParseSocialPointCost(cfg.ConfigValue)
	if !ok {
		return 0, errors.New("下载或拆解积分配置无效，请联系管理员")
	}
	return n, nil
}

// The request claim, immutable price, balance debit and ledger are committed
// together. Retrying a request never creates a second execution or debit.
func BeginSocial(db *gorm.DB, record *model.SocialActivityRecord, requestID string, expectedPrice ...*int) (bool, error) {
	if len(requestID) > 100 {
		return false, ErrSocialRequest
	}
	if requestID == "" {
		requestID = idgen.Next().String()
	}
	key := record.UserID.String() + ":" + requestID
	record.RequestKey = &key
	record.RequestHash = fmt.Sprintf("%x", sha256.Sum256([]byte(record.ActivityType+"\n"+record.Kind+"\n"+record.SourceURL+"\n"+record.Quality)))
	lookup := func() (bool, error) {
		var previous model.SocialActivityRecord
		err := db.Unscoped().Where("request_key = ?", key).First(&previous).Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return false, nil
		}
		if err != nil {
			return false, err
		}
		if previous.RequestHash != record.RequestHash || previous.UserID != record.UserID {
			return true, ErrSocialRequest
		}
		*record = previous
		return true, nil
	}
	if found, err := lookup(); found || err != nil {
		return found, err
	}
	err := db.Transaction(func(tx *gorm.DB) error {
		price, err := SocialPrice(tx, record.ActivityType)
		if err != nil {
			return err
		}
		if len(expectedPrice) > 0 && expectedPrice[0] != nil && *expectedPrice[0] != price {
			return ErrSocialPriceChanged
		}
		record.PointCost = price
		if err := tx.Create(record).Error; err != nil {
			return err
		}
		label := "内容拆解"
		if record.ActivityType == model.SocialActivityDownload {
			label = "视频下载"
		}
		return Consume(tx, record.UserID, price, label+"单次执行", record.ID)
	})
	if err != nil {
		if found, lookupErr := lookup(); found || lookupErr != nil {
			return found, lookupErr
		}
	}
	return false, err
}

// FailSocial uses its own transaction, independent of the cancelled HTTP
// context. A late failure cannot refund a successfully delivered execution.
func FailSocial(db *gorm.DB, id idgen.ID, message string, reportFailure bool) error {
	return db.Transaction(func(tx *gorm.DB) error {
		var r model.SocialActivityRecord
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&r, "id = ?", id).Error; err != nil {
			return err
		}
		if r.Status == model.SocialActivitySucceeded && !reportFailure {
			return nil
		}
		if r.Refunded {
			return nil
		}
		if err := Refund(tx, r.UserID, r.PointCost, "下载/内容拆解失败退款", r.ID); err != nil {
			return err
		}
		values := map[string]any{"refunded": r.PointCost > 0, "error_message": message, "completed_at": time.Now()}
		if !reportFailure {
			values["status"] = model.SocialActivityFailed
			if r.Status == model.SocialActivityExpired || (r.Status == model.SocialActivityReady && r.ExpiresAt != nil && !r.ExpiresAt.After(time.Now())) {
				values["status"] = model.SocialActivityExpired
			}
		}
		return tx.Model(&r).Updates(values).Error
	})
}

// ClaimSocialReport is called only inside the AI task transaction after the
// server has validated run/step ownership. No browser parameter can waive fees.
func ClaimSocialReport(tx *gorm.DB, runID, userID, activityID, taskID idgen.ID, handler string) (bool, error) {
	var r model.SocialActivityRecord
	err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("id = ? AND analysis_run_id = ? AND user_id = ? AND point_cost > 0", activityID, runID, userID).First(&r).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return false, ErrSocialUnavailable
	}
	if err != nil {
		return false, err
	}
	if r.ActivityType != model.SocialActivityAnalysis || r.Status != model.SocialActivitySucceeded || r.Refunded || r.ReportTaskID != 0 || handler != "skill_text_completion" {
		return false, ErrSocialUnavailable
	}
	var count int64
	if err := tx.Table("skill_run AS r").Joins("JOIN skill AS s ON s.id = r.skill_id").
		Where("r.id = ? AND s.seed_key IN ?", runID, []string{"tool-account-analysis", "tool-video-analysis", "tool-image-analysis"}).Count(&count).Error; err != nil {
		return false, err
	}
	if count != 1 {
		return false, ErrSocialUnavailable
	}
	return true, tx.Model(&r).Update("report_task_id", taskID).Error
}

// ReconcileSocialCharges also runs after restarts: abandoned reservations and
// failed report runs refund the original captured price, at most once.
func ReconcileSocialCharges(db *gorm.DB, now time.Time) error {
	return reconcileSocialCharges(db, db, now)
}

// History reads reconcile only the selected owner's downloads. Status and
// refund commit together; the browser must never stop polling before a refund.
func ReconcileSocialDownloads(db *gorm.DB, ownerID *idgen.ID, now time.Time) error {
	query := db.Where("activity_type = ?", model.SocialActivityDownload)
	if ownerID != nil {
		query = query.Where("user_id = ?", *ownerID)
	}
	return reconcileSocialCharges(db, query, now)
}

func reconcileSocialCharges(db, query *gorm.DB, now time.Time) error {
	var rows []model.SocialActivityRecord
	err := query.Where("point_cost > 0 AND refunded = ? AND (status IN ? OR (status = ? AND update_time < ?) OR (status = ? AND update_time < ?) OR (status = ? AND expires_at < ?) OR (status = ? AND analysis_run_id IN (SELECT id FROM skill_run WHERE status IN ('failed', 'cancelled'))))",
		false, []string{model.SocialActivityFailed, model.SocialActivityExpired}, model.SocialActivityProcessing, now.Add(-10*time.Minute),
		model.SocialActivityDownloading, now.Add(-61*time.Minute), model.SocialActivityReady, now,
		model.SocialActivitySucceeded).Find(&rows).Error
	if err != nil {
		return err
	}
	var recoveryErrors []error
	for _, r := range rows {
		reportFailure := r.Status == model.SocialActivitySucceeded
		if reportFailure {
			if err := RefundFailedSocialRun(db, r.AnalysisRunID); err != nil {
				recoveryErrors = append(recoveryErrors, fmt.Errorf("report %s: %w", r.ID, err))
			}
			continue
		}
		// Lock and recheck the state in the same transaction as the refund; a
		// download may have started/completed since the candidates were read.
		err := db.Transaction(func(tx *gorm.DB) error {
			var current model.SocialActivityRecord
			if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&current, "id = ?", r.ID).Error; err != nil {
				return err
			}
			if current.Status != r.Status || !current.UpdateTime.Equal(r.UpdateTime) {
				return nil
			}
			return FailSocial(tx, r.ID, "执行已中断或超时，积分已退回，请重新发起", false)
		})
		if err != nil {
			recoveryErrors = append(recoveryErrors, fmt.Errorf("execution %s: %w", r.ID, err))
		}
	}
	return errors.Join(recoveryErrors...)
}

// Called after a terminal run transition (not while holding the run lock).
func RefundFailedSocialRun(db *gorm.DB, runID idgen.ID) error {
	return db.Transaction(func(tx *gorm.DB) error {
		var run model.SkillRun
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Select("status", "user_id", "social_activity_id").First(&run, "id = ?", runID).Error; err != nil {
			return err
		}
		if run.Status != model.SkillRunFailed && run.Status != model.SkillRunCancelled {
			return nil
		}
		// Most skills do not have a social execution; avoid unrelated lookups.
		if run.SocialActivityID == 0 {
			return nil
		}
		var r model.SocialActivityRecord
		err := tx.Where("id = ? AND analysis_run_id = ? AND user_id = ? AND point_cost > 0 AND refunded = ?", run.SocialActivityID, runID, run.UserID, false).First(&r).Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil
		}
		if err != nil {
			return err
		}
		return FailSocial(tx, r.ID, "AI 报告未完成，本次拆解积分已退回", true)
	})
}
