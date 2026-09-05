package social

import (
	"context"
	"encoding/json"
	"errors"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
	"tidecanvas/internal/handler/points"
	"tidecanvas/internal/middleware"
	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/idgen"
	"tidecanvas/internal/pkg/response"
)

func setDownloadDailyLimit(t *testing.T, db *gorm.DB, value string) {
	t.Helper()
	cfg := model.SysConfig{ConfigKey: model.ConfigKeySocialDownloadDailyLimit}
	if err := db.Where("config_key = ?", cfg.ConfigKey).Assign(model.SysConfig{ConfigValue: value}).FirstOrCreate(&cfg).Error; err != nil {
		t.Fatal(err)
	}
}

func quotaRecord(owner idgen.ID) model.SocialActivityRecord {
	return model.SocialActivityRecord{UserID: owner, ActivityType: model.SocialActivityDownload, SourceURL: "https://youtu.be/abcdefghijk", Quality: "quality", Status: model.SocialActivityProcessing}
}

func TestDownloadDailyQuotaDefaultReplayRefundAndOwnerIsolation(t *testing.T) {
	db := activityTestDB(t)
	fundSocialUser(t, db, 42, 10)
	fundSocialUser(t, db, 43, 10)
	first := quotaRecord(42)
	if _, err := points.BeginSocial(db, &first, "first"); err != nil {
		t.Fatal(err)
	}
	retry := quotaRecord(42)
	if replay, err := points.BeginSocial(db, &retry, "first"); err != nil || !replay || retry.ID != first.ID {
		t.Fatalf("replay=%v err=%v", replay, err)
	}
	blocked := quotaRecord(42)
	if _, err := points.BeginSocial(db, &blocked, "second"); !errors.Is(err, points.ErrSocialDownloadDailyLimit) {
		t.Fatalf("limit bypass: %v", err)
	}
	if socialBalance(t, db, 42) != 9 {
		t.Fatal("blocked request charged")
	}
	other := quotaRecord(43)
	if _, err := points.BeginSocial(db, &other, "first"); err != nil {
		t.Fatal(err)
	}
	for range 2 {
		if err := points.FailSocial(db, first.ID, "failed", false); err != nil {
			t.Fatal(err)
		}
	}
	quota, err := points.DownloadQuota(db, 42, time.Now())
	if err != nil || quota.DailyLimit != 1 || quota.DailyUsed != 0 || quota.DailyRemaining != 1 {
		t.Fatalf("refund quota=%+v err=%v", quota, err)
	}
	if _, err := points.BeginSocial(db, &blocked, "second"); err != nil {
		t.Fatal(err)
	}
	if socialBalance(t, db, 42) != 9 {
		t.Fatal("wrong refund/retry balance")
	}
}

func TestDownloadQuotaLiveConfigDeletionAndInsufficientBalance(t *testing.T) {
	db := activityTestDB(t)
	fundSocialUser(t, db, 42, 1)
	first := quotaRecord(42)
	if _, err := points.BeginSocial(db, &first, "first"); err != nil {
		t.Fatal(err)
	}
	if err := db.Delete(&first).Error; err != nil {
		t.Fatal(err)
	}
	q, err := points.DownloadQuota(db, 42, time.Now())
	if err != nil || q.DailyRemaining != 0 {
		t.Fatalf("deletion bypass: %+v %v", q, err)
	}
	setDownloadDailyLimit(t, db, "2")
	next := quotaRecord(42)
	if _, err := points.BeginSocial(db, &next, "next"); !errors.Is(err, points.ErrInsufficient) {
		t.Fatalf("balance bypass: %v", err)
	}
	q, err = points.DownloadQuota(db, 42, time.Now())
	if err != nil || q.DailyRemaining != 1 {
		t.Fatalf("unfunded request took slot: %+v %v", q, err)
	}
	if err := db.Model(&model.User{}).Where("id = ?", 42).Update("points", 1).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := points.BeginSocial(db, &next, "next"); err != nil {
		t.Fatal(err)
	}
	setDownloadDailyLimit(t, db, "1")
	q, err = points.DownloadQuota(db, 42, time.Now())
	if err != nil || q.DailyUsed != 2 || q.DailyRemaining != 0 {
		t.Fatalf("lowered quota=%+v err=%v", q, err)
	}
	setDownloadDailyLimit(t, db, "0")
	if _, err := points.DownloadQuota(db, 42, time.Now()); err == nil {
		t.Fatal("invalid configuration failed open")
	}
}

func TestDownloadDailyQuotaResetsAtBeijingMidnight(t *testing.T) {
	db := activityTestDB(t)
	fundSocialUser(t, db, 42, 10)
	// These UTC instants straddle midnight in China, even on a UTC server.
	before := time.Date(2026, 9, 5, 15, 59, 59, 0, time.UTC)
	db = db.Session(&gorm.Session{NowFunc: func() time.Time { return before }})
	first := quotaRecord(42)
	if _, err := points.BeginSocial(db, &first, "yesterday"); err != nil {
		t.Fatal(err)
	}
	q, err := points.DownloadQuota(db, 42, before)
	if err != nil || q.DailyRemaining != 0 || q.DailyResetAt != before.Add(time.Second).Unix() {
		t.Fatalf("before=%+v %v", q, err)
	}
	after := before.Add(time.Second)
	db = db.Session(&gorm.Session{NowFunc: func() time.Time { return after }})
	q, err = points.DownloadQuota(db, 42, after)
	if err != nil || q.DailyRemaining != 1 {
		t.Fatalf("after=%+v %v", q, err)
	}
	second := quotaRecord(42)
	if _, err := points.BeginSocial(db, &second, "today"); err != nil {
		t.Fatal(err)
	}
	if err := points.FailSocial(db, first.ID, "yesterday failed", false); err != nil {
		t.Fatal(err)
	}
	q, err = points.DownloadQuota(db, 42, after)
	if err != nil || q.DailyRemaining != 0 || q.DailyUsed != 1 {
		t.Fatalf("yesterday refund released today's slot: %+v %v", q, err)
	}
}

func TestConcurrentDownloadReservationsRespectDailyLimit(t *testing.T) {
	db := activityTestDB(t)
	sqlDB, _ := db.DB()
	sqlDB.SetMaxOpenConns(1) // SQLite serializes writes; production uses the user row lock.
	fundSocialUser(t, db, 42, 20)
	var wg sync.WaitGroup
	results := make(chan error, 8)
	for range 8 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			r := quotaRecord(42)
			_, err := points.BeginSocial(db, &r, "")
			results <- err
		}()
	}
	wg.Wait()
	close(results)
	accepted := 0
	for err := range results {
		if err == nil {
			accepted++
		} else if !errors.Is(err, points.ErrSocialDownloadDailyLimit) {
			t.Fatal(err)
		}
	}
	if accepted != 1 || socialBalance(t, db, 42) != 19 {
		t.Fatalf("accepted=%d", accepted)
	}
}

func TestExhaustedDownloadNeverCallsResolverAndCapabilitiesArePersonal(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db := activityTestDB(t)
	fundSocialUser(t, db, 42, 10)
	fundSocialUser(t, db, 43, 10)
	r := quotaRecord(42)
	if _, err := points.BeginSocial(db, &r, "used"); err != nil {
		t.Fatal(err)
	}
	h := &handler{db: db, downloader: &stubVideoDownloader{onResolve: func(context.Context, string, string) (videoDownloadResolveVO, error) {
		t.Error("quota failure reached resolver")
		return videoDownloadResolveVO{}, errors.New("unexpected")
	}}}
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Set(middleware.CtxUserID, idgen.ID(42))
	c.Request = httptest.NewRequest("POST", "/resolve", strings.NewReader(`{"url":"https://youtu.be/abcdefghijk","quality":"quality","clientRequestId":"new"}`))
	c.Request.Header.Set("Content-Type", "application/json")
	h.resolveVideoDownload(c)
	var blocked response.Result[any]
	if err := json.Unmarshal(w.Body.Bytes(), &blocked); err != nil || blocked.Code != response.CodeForbidden || !strings.Contains(blocked.Message, "次数") {
		t.Fatalf("%s", w.Body)
	}
	for _, owner := range []idgen.ID{42, 43} {
		w = httptest.NewRecorder()
		c, _ = gin.CreateTestContext(w)
		c.Set(middleware.CtxUserID, owner)
		c.Request = httptest.NewRequest("GET", "/platforms", nil)
		h.downloaderPlatforms(c)
		var got response.Result[downloaderCapabilitiesVO]
		if err := json.Unmarshal(w.Body.Bytes(), &got); err != nil || !got.Success {
			t.Fatalf("%s", w.Body)
		}
		want := int64(0)
		if owner == 43 {
			want = 1
		}
		if got.Data.PointCost != 1 || got.Data.DailyLimit != 1 || got.Data.DailyRemaining != want || w.Header().Get("Cache-Control") != "private, no-store" {
			t.Fatalf("owner=%s: %s", owner, w.Body)
		}
	}
}
