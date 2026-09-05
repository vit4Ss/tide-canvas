package points

import (
	"errors"
	"fmt"
	"time"

	"gorm.io/gorm"
	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/idgen"
)

var ErrSocialDownloadDailyLimit = errors.New("今日下载次数已用完")

var socialDownloadDayZone = time.FixedZone("Asia/Shanghai", 8*60*60)

type SocialDownloadQuota struct {
	DailyLimit     int   `json:"dailyLimit"`
	DailyUsed      int64 `json:"dailyUsed"`
	DailyRemaining int64 `json:"dailyRemaining"`
	DailyResetAt   int64 `json:"dailyResetAt"`
}

// Downloads are counted on the Beijing calendar day when they were reserved.
// Retried/continued transfers reuse the same row. Refunds release the slot, and
// deleting history cannot release it. Legacy successful downloads also count.
func DownloadQuota(db *gorm.DB, userID idgen.ID, now time.Time) (SocialDownloadQuota, error) {
	quota := SocialDownloadQuota{DailyLimit: 1}
	var cfg model.SysConfig
	err := db.Where("config_key = ?", model.ConfigKeySocialDownloadDailyLimit).First(&cfg).Error
	if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return quota, err
	}
	if err == nil {
		var ok bool
		quota.DailyLimit, ok = model.ParseSocialDownloadDailyLimit(cfg.ConfigValue)
		if !ok {
			return quota, errors.New("每日下载次数配置无效，请联系管理员")
		}
	}
	local := now.In(socialDownloadDayZone)
	start := time.Date(local.Year(), local.Month(), local.Day(), 0, 0, 0, 0, socialDownloadDayZone).In(now.Location())
	end := start.Add(24 * time.Hour)
	quota.DailyResetAt = end.Unix()
	err = db.Unscoped().Model(&model.SocialActivityRecord{}).
		Where("user_id = ? AND activity_type = ? AND create_time >= ? AND create_time < ? AND refunded = ? AND (point_cost > 0 OR status = ?)",
			userID, model.SocialActivityDownload, start, end, false, model.SocialActivitySucceeded).
		Count(&quota.DailyUsed).Error
	quota.DailyRemaining = max(0, int64(quota.DailyLimit)-quota.DailyUsed)
	return quota, err
}

func (q SocialDownloadQuota) limitError() error {
	return fmt.Errorf("%w（每天最多 %d 次），北京时间零点重置；本次未扣积分", ErrSocialDownloadDailyLimit, q.DailyLimit)
}
