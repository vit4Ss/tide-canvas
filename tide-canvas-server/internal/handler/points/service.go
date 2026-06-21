package points

import (
	"context"
	"fmt"
	"time"

	"github.com/redis/go-redis/v9"
	"gorm.io/gorm"

	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/idgen"
)

// service.go holds points business logic: balance lookup, ledger paging and the
// idempotent daily check-in (streak calculation + reward). Idempotency is
// enforced primarily by the CheckinRecord unique (user, date) index, with an
// optional Redis SETNX fast-path to skip a redundant DB transaction.

// changeTypeCheckin is the ledger ChangeType for daily check-in rewards.
const changeTypeCheckin = "checkin"

// checkinReward is the points granted per daily check-in.
const checkinReward = 10

// checkinKeyTTL bounds the Redis dedup key lifetime so stale keys self-expire.
const checkinKeyTTL = 36 * time.Hour

type service struct {
	repo *repo
	rdb  *redis.Client
}

func newService(db *gorm.DB, rdb *redis.Client) *service {
	return &service{repo: newRepo(db), rdb: rdb}
}

// balance returns the user's current usable points and frozen (held) points.
// The User model has no frozen column, so frozen is reported as 0.
func (s *service) balance(userID idgen.ID) (*BalanceVO, error) {
	pts, err := s.repo.userPoints(userID)
	if err != nil {
		return nil, err
	}
	return &BalanceVO{Points: pts, Frozen: 0}, nil
}

// records returns a page of the user's point ledger as VOs.
func (s *service) records(userID idgen.ID, q *RecordQuery) ([]PointRecordVO, int64, error) {
	rows, total, err := s.repo.listRecords(userID, q)
	if err != nil {
		return nil, 0, err
	}
	vos := make([]PointRecordVO, 0, len(rows))
	for i := range rows {
		vos = append(vos, toPointRecordVO(&rows[i]))
	}
	return vos, total, nil
}

// checkinStatus reports whether the user has checked in today and the streak
// length. The streak is the latest check-in's ContinuousDays when it is still
// current (today or yesterday); otherwise the streak is considered broken (0).
func (s *service) checkinStatus(userID idgen.ID) (*CheckinStatusVO, error) {
	today := dayKey(time.Now())

	rec, err := s.repo.findCheckin(userID, today)
	if err != nil {
		return nil, err
	}
	if rec != nil {
		return &CheckinStatusVO{CheckedToday: true, ContinuousDays: rec.ContinuousDays}, nil
	}

	// Not checked in today: surface the live streak only if yesterday was the
	// last check-in, otherwise the streak has lapsed.
	latest, err := s.repo.latestCheckin(userID)
	if err != nil {
		return nil, err
	}
	streak := 0
	if latest != nil && latest.CheckinDate == dayKey(time.Now().AddDate(0, 0, -1)) {
		streak = latest.ContinuousDays
	}
	return &CheckinStatusVO{CheckedToday: false, ContinuousDays: streak}, nil
}

// checkin performs the idempotent daily check-in. On the first call for the day
// it awards points, persists a CheckinRecord + PointRecord and bumps the user's
// balance, returning rewarded=true. Subsequent calls the same day are no-ops
// that return the existing streak with rewarded=false.
func (s *service) checkin(userID idgen.ID) (*CheckinResultVO, error) {
	now := time.Now()
	today := dayKey(now)

	// Redis SETNX fast-path: if the key already exists, the user has checked in
	// today, so we can short-circuit without a DB write. Best-effort only —
	// any Redis error falls through to the authoritative DB path.
	dedupHit := false
	if s.rdb != nil {
		ctx := context.Background()
		ok, err := s.rdb.SetNX(ctx, checkinRedisKey(userID, today), 1, checkinKeyTTL).Result()
		if err == nil && !ok {
			dedupHit = true
		}
	}

	if dedupHit {
		rec, err := s.repo.findCheckin(userID, today)
		if err != nil {
			return nil, err
		}
		if rec != nil {
			return &CheckinResultVO{Points: rec.Points, ContinuousDays: rec.ContinuousDays, Rewarded: false}, nil
		}
		// Redis flagged a check-in the DB does not have (e.g. a prior crash);
		// fall through and let the DB be authoritative.
	}

	// Already checked in today? (covers SETNX disabled / race / Redis miss).
	if existing, err := s.repo.findCheckin(userID, today); err != nil {
		return nil, err
	} else if existing != nil {
		return &CheckinResultVO{Points: existing.Points, ContinuousDays: existing.ContinuousDays, Rewarded: false}, nil
	}

	// Compute the new streak from the latest prior check-in.
	continuousDays := 1
	if latest, err := s.repo.latestCheckin(userID); err != nil {
		return nil, err
	} else if latest != nil && latest.CheckinDate == dayKey(now.AddDate(0, 0, -1)) {
		continuousDays = latest.ContinuousDays + 1
	}

	_, rewarded, err := s.repo.applyCheckin(userID, today, checkinReward, continuousDays)
	if err != nil {
		return nil, err
	}
	if !rewarded {
		// Lost a race against a concurrent check-in for the same day: report the
		// persisted record with rewarded=false.
		if existing, e := s.repo.findCheckin(userID, today); e == nil && existing != nil {
			return &CheckinResultVO{Points: existing.Points, ContinuousDays: existing.ContinuousDays, Rewarded: false}, nil
		}
		return &CheckinResultVO{Points: 0, ContinuousDays: continuousDays, Rewarded: false}, nil
	}

	return &CheckinResultVO{Points: checkinReward, ContinuousDays: continuousDays, Rewarded: true}, nil
}

// dayKey renders a time as the YYYY-MM-DD key used by CheckinRecord and the
// Redis dedup key. Local time is used so a "day" matches the server's calendar.
func dayKey(t time.Time) string {
	return t.Format("2006-01-02")
}

// checkinRedisKey builds the per-user, per-day check-in dedup key.
// Format: points:checkin:{uid}:{YYYY-MM-DD}
func checkinRedisKey(userID idgen.ID, day string) string {
	return fmt.Sprintf("points:checkin:%s:%s", userID.String(), day)
}

// Seed inserts a few PointRecord rows for the seeded admin user (e.g. a signup
// bonus) so the points ledger is non-empty in a fresh database. It is
// idempotent: it does nothing if the admin already has point records, or if no
// admin user exists yet.
func Seed(db *gorm.DB) error {
	var admin model.User
	err := db.Select("id", "points").Where("role = ?", 9).Order("create_time ASC").First(&admin).Error
	if err != nil {
		if err == gorm.ErrRecordNotFound {
			return nil // admin not seeded yet; nothing to do
		}
		return err
	}

	var count int64
	if err := db.Model(&model.PointRecord{}).Where("user_id = ?", admin.ID).Count(&count).Error; err != nil {
		return err
	}
	if count > 0 {
		return nil // already seeded
	}

	balance := int(admin.Points)
	records := []model.PointRecord{
		{ChangeType: "signup", Amount: 100, Remark: "注册奖励"},
		{ChangeType: changeTypeCheckin, Amount: 10, Remark: "每日签到奖励"},
		{ChangeType: "reward", Amount: 50, Remark: "新手任务奖励"},
	}
	rows := make([]model.PointRecord, 0, len(records))
	for _, r := range records {
		r.ID = idgen.Next()
		r.UserID = admin.ID
		r.Balance = balance
		rows = append(rows, r)
	}
	if err := db.Create(&rows).Error; err != nil {
		if err == gorm.ErrDuplicatedKey {
			return nil
		}
		return err
	}
	return nil
}
