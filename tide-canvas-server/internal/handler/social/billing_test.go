package social

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
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

func fundSocialUser(t *testing.T, db *gorm.DB, id idgen.ID, balance int64) {
	t.Helper()
	if err := db.Create(&model.User{ID: id, Username: "social-" + id.String(), Email: "social-" + id.String() + "@example.com", Points: balance}).Error; err != nil {
		t.Fatal(err)
	}
}

func TestPaidDownloadClaimIsSharedAcrossServerInstances(t *testing.T) {
	db := activityTestDB(t)
	r := paidDownloadFixture(t, db, 1, 42)
	started, release := make(chan struct{}), make(chan struct{})
	var calls atomic.Int32
	downloader := &stubVideoDownloader{onDownload: func(context.Context, string, string) (*http.Response, error) {
		calls.Add(1)
		close(started)
		<-release
		return videoResponse("complete-video"), nil
	}}
	first, second := &handler{db: db, downloader: downloader}, &handler{db: db, downloader: downloader}
	request := func(h *handler) *httptest.ResponseRecorder {
		w := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(w)
		c.Request = httptest.NewRequest("GET", "/download", nil)
		c.Set(middleware.CtxUserID, r.UserID)
		c.Set("socialDownloadRecordID", r.ID)
		h.downloadVideo(c)
		return w
	}
	done := make(chan *httptest.ResponseRecorder, 1)
	go func() { done <- request(first) }()
	select {
	case <-started:
	case <-time.After(5 * time.Second):
		t.Fatal("first download did not start")
	}
	blocked := request(second)
	close(release)
	completed := <-done
	if calls.Load() != 1 || completed.Body.String() != "complete-video" || !strings.Contains(blocked.Body.String(), `"success":false`) {
		t.Fatalf("calls=%d duplicate=%s completed=%s", calls.Load(), blocked.Body, completed.Body)
	}
	if socialBalance(t, db, 42) != 9 {
		t.Fatal("duplicate transfer changed prepaid balance")
	}
	var got model.SocialActivityRecord
	if err := db.First(&got, r.ID).Error; err != nil {
		t.Fatal(err)
	}
	if got.Status != model.SocialActivitySucceeded || got.Refunded {
		t.Fatalf("duplicate refunded active transfer: %+v", got)
	}
}
func socialBalance(t *testing.T, db *gorm.DB, id idgen.ID) int64 {
	t.Helper()
	var u model.User
	if err := db.First(&u, "id = ?", id).Error; err != nil {
		t.Fatal(err)
	}
	return u.Points
}

func TestExpiredPaidHistoryRefundsAtomicallyAndOnlyForOwner(t *testing.T) {
	db := activityTestDB(t)
	fundSocialUser(t, db, 42, 1)
	fundSocialUser(t, db, 43, 1)
	expired := time.Now().Add(-time.Minute)
	rows := []model.SocialActivityRecord{
		{UserID: 42, ActivityType: model.SocialActivityDownload, Status: model.SocialActivityReady, ExpiresAt: &expired},
		{UserID: 43, ActivityType: model.SocialActivityDownload, Status: model.SocialActivityReady, ExpiresAt: &expired},
	}
	for i := range rows {
		if _, err := points.BeginSocial(db, &rows[i], "expired"); err != nil {
			t.Fatal(err)
		}
	}
	// Fail the refund ledger write after the balance update. Both that update
	// and the final activity state must roll back, leaving recovery possible.
	if err := db.Callback().Create().Before("gorm:create").Register("test:refund-ledger-failure", func(tx *gorm.DB) {
		if tx.Statement.Table == "point_record" {
			tx.AddError(errors.New("ledger unavailable"))
		}
	}); err != nil {
		t.Fatal(err)
	}
	closeAbandonedDownloads(db, &rows[0].UserID, time.Now())
	var got model.SocialActivityRecord
	if err := db.First(&got, rows[0].ID).Error; err != nil {
		t.Fatal(err)
	}
	if got.Status != model.SocialActivityReady || got.Refunded || socialBalance(t, db, 42) != 0 {
		t.Fatalf("partially committed expiry/refund: %+v", got)
	}
	if err := db.Callback().Create().Remove("test:refund-ledger-failure"); err != nil {
		t.Fatal(err)
	}
	for range 2 {
		closeAbandonedDownloads(db, &rows[0].UserID, time.Now())
	}
	if err := db.First(&got, rows[0].ID).Error; err != nil {
		t.Fatal(err)
	}
	if got.Status != model.SocialActivityExpired || !got.Refunded || socialBalance(t, db, 42) != 1 {
		t.Fatalf("expiry not refunded exactly once: %+v", got)
	}
	var foreign model.SocialActivityRecord
	if err := db.First(&foreign, rows[1].ID).Error; err != nil {
		t.Fatal(err)
	}
	if foreign.Status != model.SocialActivityReady || foreign.Refunded || socialBalance(t, db, 43) != 0 {
		t.Fatalf("history changed another user's reservation: %+v", foreign)
	}
}

func TestLateDownloadCompletionCannotOverwriteRefundedFailure(t *testing.T) {
	db := activityTestDB(t)
	r := paidDownloadFixture(t, db, 1, 42)
	if err := db.Model(&r).Update("status", model.SocialActivityDownloading).Error; err != nil {
		t.Fatal(err)
	}
	if err := points.FailSocial(db, r.ID, "interrupted", false); err != nil {
		t.Fatal(err)
	}
	h := &handler{db: db}
	h.completeDownloadActivity(&r, 128)
	var got model.SocialActivityRecord
	if err := db.First(&got, r.ID).Error; err != nil {
		t.Fatal(err)
	}
	if got.Status != model.SocialActivityFailed || !got.Refunded || got.DownloadedBytes != 0 || socialBalance(t, db, 42) != 10 {
		t.Fatalf("late callback resurrected refunded download: %+v", got)
	}
}
func paidDownloadFixture(t *testing.T, db *gorm.DB, id, owner idgen.ID) model.SocialActivityRecord {
	t.Helper()
	fundSocialUser(t, db, owner, 10)
	expires := time.Now().Add(time.Minute)
	r := model.SocialActivityRecord{ID: id, UserID: owner, ActivityType: model.SocialActivityDownload, SourceURL: "https://youtu.be/abcdefghijk", Quality: "compat", Status: model.SocialActivityReady, ExpiresAt: &expires}
	if _, err := points.BeginSocial(db, &r, ""); err != nil {
		t.Fatal(err)
	}
	return r
}
func TestSocialChargeAtomicIdempotentAndRefundOriginalPrice(t *testing.T) {
	db := activityTestDB(t)
	fundSocialUser(t, db, 42, 5)
	newRecord := func() model.SocialActivityRecord {
		return model.SocialActivityRecord{UserID: 42, ActivityType: model.SocialActivityAnalysis, Kind: "content", SourceURL: "https://example.com/video", Status: model.SocialActivityProcessing}
	}
	r := newRecord()
	if replay, err := points.BeginSocial(db, &r, "request-1"); err != nil || replay {
		t.Fatalf("begin=%v %v", replay, err)
	}
	retry := newRecord()
	if replay, err := points.BeginSocial(db, &retry, "request-1"); err != nil || !replay || retry.ID != r.ID {
		t.Fatalf("retry=%+v %v", retry, err)
	}
	conflict := newRecord()
	conflict.Kind = "account"
	if _, err := points.BeginSocial(db, &conflict, "request-1"); !errors.Is(err, points.ErrSocialRequest) {
		t.Fatalf("payload conflict accepted: %v", err)
	}
	if got := socialBalance(t, db, 42); got != 4 {
		t.Fatalf("balance=%d", got)
	}
	quote := 2
	stale := newRecord()
	if _, err := points.BeginSocial(db, &stale, "outdated-quote", &quote); !errors.Is(err, points.ErrSocialPriceChanged) {
		t.Fatalf("outdated quote: %v", err)
	}
	if socialBalance(t, db, 42) != 4 {
		t.Fatal("outdated quote charged")
	}
	if err := db.Create(&model.SysConfig{ConfigKey: model.ConfigKeySocialAnalysisCost, ConfigValue: "5"}).Error; err != nil {
		t.Fatal(err)
	}
	blocked := newRecord()
	if _, err := points.BeginSocial(db, &blocked, "request-2"); !errors.Is(err, points.ErrInsufficient) {
		t.Fatalf("insufficient=%v", err)
	}
	for range 2 {
		if err := points.FailSocial(db, r.ID, "failed", false); err != nil {
			t.Fatal(err)
		}
	}
	if got := socialBalance(t, db, 42); got != 5 {
		t.Fatalf("refund used new price or duplicated: %d", got)
	}
	var count int64
	db.Model(&model.PointRecord{}).Count(&count)
	if count != 2 {
		t.Fatalf("ledger entries=%d", count)
	}
}
func TestSocialInsufficientNeverCallsPlatform(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db := activityTestDB(t)
	fundSocialUser(t, db, 42, 0)
	called := false
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { called = true; w.WriteHeader(500) }))
	defer upstream.Close()
	for _, cfg := range []model.SysConfig{{ConfigKey: model.ConfigKeySocialTikHubAPIKey, ConfigValue: "test"}, {ConfigKey: model.ConfigKeySocialTikHubBaseURL, ConfigValue: upstream.URL}} {
		if err := db.Create(&cfg).Error; err != nil {
			t.Fatal(err)
		}
	}
	h := &handler{db: db, httpcli: upstream.Client(), downloader: &stubVideoDownloader{}}
	for _, endpoint := range []string{"inspect", "resolve"} {
		w := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(w)
		c.Set(middleware.CtxUserID, idgen.ID(42))
		c.Request = httptest.NewRequest("POST", "/"+endpoint, strings.NewReader(`{"url":"https://www.douyin.com/video/123","kind":"content","quality":"quality"}`))
		c.Request.Header.Set("Content-Type", "application/json")
		if endpoint == "inspect" {
			h.inspect(c)
		} else {
			h.resolveVideoDownload(c)
		}
		var got response.Result[any]
		if json.Unmarshal(w.Body.Bytes(), &got) != nil || got.Code != response.CodeQuotaInsufficient {
			t.Fatalf("%s: %s", endpoint, w.Body)
		}
	}
	if called {
		t.Fatal("unfunded request reached platform")
	}
	var count int64
	db.Model(&model.SocialActivityRecord{}).Count(&count)
	if count != 0 {
		t.Fatal("unfunded request created execution")
	}
}
func TestSocialRecoveryRefundsUnusedAndAbandonedButNotActiveOrSuccess(t *testing.T) {
	db := activityTestDB(t)
	setDownloadDailyLimit(t, db, "10")
	fundSocialUser(t, db, 42, 10)
	now := time.Now()
	var records []model.SocialActivityRecord
	for i, status := range []string{model.SocialActivityReady, model.SocialActivityDownloading, model.SocialActivityDownloading, model.SocialActivitySucceeded, model.SocialActivityProcessing} {
		expiry := now.Add(-time.Minute)
		r := model.SocialActivityRecord{UserID: 42, ActivityType: model.SocialActivityDownload, Status: status, ExpiresAt: &expiry}
		if _, err := points.BeginSocial(db, &r, ""); err != nil {
			t.Fatal(err)
		}
		if i == 1 || i == 4 {
			db.Model(&r).UpdateColumn("update_time", now.Add(-2*time.Hour))
		}
		records = append(records, r)
	}
	for range 2 {
		if err := points.ReconcileSocialCharges(db, now); err != nil {
			t.Fatal(err)
		}
	}
	if got := socialBalance(t, db, 42); got != 8 {
		t.Fatalf("recovery balance=%d", got)
	}
	for i, r := range records {
		var got model.SocialActivityRecord
		db.First(&got, r.ID)
		want := i == 0 || i == 1 || i == 4
		if got.Refunded != want {
			t.Fatalf("record %d refunded=%v", i, got.Refunded)
		}
	}
}
func TestSocialConcurrentRequestsCannotOverspend(t *testing.T) {
	db := activityTestDB(t)
	sqlDB, _ := db.DB()
	sqlDB.SetMaxOpenConns(1)
	fundSocialUser(t, db, 42, 1)
	var wg sync.WaitGroup
	results := make(chan error, 8)
	for range 8 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			r := model.SocialActivityRecord{UserID: 42, ActivityType: model.SocialActivityAnalysis, Status: model.SocialActivityProcessing}
			_, err := points.BeginSocial(db, &r, "")
			results <- err
		}()
	}
	wg.Wait()
	close(results)
	success := 0
	for err := range results {
		if err == nil {
			success++
		} else if !errors.Is(err, points.ErrInsufficient) {
			t.Fatal(err)
		}
	}
	if success != 1 || socialBalance(t, db, 42) != 0 {
		t.Fatalf("successful charges=%d", success)
	}
}
func TestPaidDownloadFailureRefundsAndCannotReuseTicket(t *testing.T) {
	db := activityTestDB(t)
	r := paidDownloadFixture(t, db, 1, 42)
	h := &handler{db: db, downloader: &stubVideoDownloader{onDownload: func(context.Context, string, string) (*http.Response, error) {
		return nil, errors.New("connection failed")
	}}}
	for range 2 {
		w := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(w)
		c.Request = httptest.NewRequest("GET", "/download", nil)
		c.Set(middleware.CtxUserID, r.UserID)
		c.Set("socialDownloadRecordID", r.ID)
		h.downloadVideo(c)
	}
	if got := socialBalance(t, db, 42); got != 10 {
		t.Fatalf("balance=%d", got)
	}
}

func TestPaidReservationRestorationIsOwnerOnlyAndDoesNotChargeAgain(t *testing.T) {
	db := activityTestDB(t)
	r := paidDownloadFixture(t, db, 1, 42)
	snapshot, _ := json.Marshal(videoDownloadResolveVO{ID: "prepared", RecordID: r.ID, DownloadURL: "private-signed-ticket", ExpiresAt: r.ExpiresAt.Unix(), PointCost: r.PointCost})
	if err := db.Model(&r).Update("snapshot_json", string(snapshot)).Error; err != nil {
		t.Fatal(err)
	}
	h := &handler{db: db}
	for _, owner := range []idgen.ID{42, 43} {
		w := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(w)
		c.Request = httptest.NewRequest("GET", "/records/1", nil)
		c.Params = gin.Params{{Key: "id", Value: "1"}}
		c.Set(middleware.CtxUserID, owner)
		h.activityRecordDetail(c)
		var result response.Result[ActivityRecordDetailVO]
		if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil {
			t.Fatal(err)
		}
		if owner == 42 {
			if !result.Success || result.Data.Download == nil || result.Data.Download.RecordID != r.ID {
				t.Fatalf("reservation not restored: %s", w.Body)
			}
		} else if result.Success || strings.Contains(w.Body.String(), "private-signed-ticket") {
			t.Fatal("foreign reservation exposed")
		}
	}
	if socialBalance(t, db, 42) != 9 {
		t.Fatal("history restoration charged again")
	}
}
func TestSocialPaidReportIsBoundToOneTaskAndRefundsOnFailure(t *testing.T) {
	db := activityTestDB(t)
	fundSocialUser(t, db, 42, 1)
	r := model.SocialActivityRecord{UserID: 42, ActivityType: model.SocialActivityAnalysis, Status: model.SocialActivitySucceeded}
	if _, err := points.BeginSocial(db, &r, ""); err != nil {
		t.Fatal(err)
	}
	skill := model.Skill{SeedKey: "tool-account-analysis"}
	if err := db.Create(&skill).Error; err != nil {
		t.Fatal(err)
	}
	run := model.SkillRun{UserID: 42, SkillID: skill.ID, Status: model.SkillRunRunning, SocialActivityID: r.ID, Input: `{}`}
	if err := db.Create(&run).Error; err != nil {
		t.Fatal(err)
	}
	db.Model(&r).Update("analysis_run_id", run.ID)
	claim := func(uid, task idgen.ID, handler string) (bool, error) {
		var covered bool
		err := db.Transaction(func(tx *gorm.DB) error {
			var err error
			covered, err = points.ClaimSocialReport(tx, run.ID, uid, r.ID, task, handler)
			return err
		})
		return covered, err
	}
	if covered, err := claim(99, 900, "skill_text_completion"); !errors.Is(err, points.ErrSocialUnavailable) || covered {
		t.Fatalf("foreign grant: %v %v", covered, err)
	}
	if _, err := claim(42, 900, "text2image"); err == nil {
		t.Fatal("arbitrary handler got report grant")
	}
	if covered, err := claim(42, 900, "skill_text_completion"); err != nil || !covered {
		t.Fatalf("paid report: %v %v", covered, err)
	}
	if _, err := claim(42, 901, "skill_text_completion"); err == nil {
		t.Fatal("second report task got free grant")
	}
	db.Model(&run).Update("status", model.SkillRunFailed)
	for range 2 {
		if err := points.RefundFailedSocialRun(db, run.ID); err != nil {
			t.Fatal(err)
		}
	}
	if got := socialBalance(t, db, 42); got != 1 {
		t.Fatalf("report refund=%d", got)
	}
	if _, err := claim(42, 902, "skill_text_completion"); err == nil {
		t.Fatal("refunded execution authorized report")
	}
}
