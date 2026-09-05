package social

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"

	"tidecanvas/internal/middleware"
	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/idgen"
	"tidecanvas/internal/pkg/response"
)

func activityTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open("file:"+t.Name()+"-"+idgen.Next().String()+"?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.User{}, &model.SocialActivityRecord{}); err != nil {
		t.Fatal(err)
	}
	return db
}

func TestSocialActivityMigrationCreatesPagingIndexes(t *testing.T) {
	db := activityTestDB(t)
	for _, name := range []string{"idx_social_activity_user_created", "idx_social_activity_type_created", "idx_social_activity_expiry", "idx_social_activity_record_create_time"} {
		if !db.Migrator().HasIndex(&model.SocialActivityRecord{}, name) {
			t.Fatalf("missing social activity query index %s", name)
		}
	}
}

func TestSuccessfulActivityCannotBeDowngradedByLateFailure(t *testing.T) {
	db := activityTestDB(t)
	record := model.SocialActivityRecord{
		ID: idgen.ID(3101), UserID: idgen.ID(3102), ActivityType: model.SocialActivityDownload,
		SourceURL: "https://www.youtube.com/watch?v=done", Status: model.SocialActivitySucceeded,
	}
	if err := db.Create(&record).Error; err != nil {
		t.Fatal(err)
	}
	h := &handler{db: db}
	h.failActivity(&record, "late duplicate request failed")
	var got model.SocialActivityRecord
	if err := db.First(&got, "id = ?", record.ID).Error; err != nil {
		t.Fatal(err)
	}
	if got.Status != model.SocialActivitySucceeded || got.ErrorMessage != "" {
		t.Fatalf("successful activity was downgraded: %+v", got)
	}
}

func TestActivityRecordsAreAlwaysScopedToCurrentUser(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db := activityTestDB(t)
	users := []model.User{
		{ID: idgen.ID(1101), Username: "alice", Email: "alice@example.com"},
		{ID: idgen.ID(1102), Username: "bob", Email: "bob@example.com"},
	}
	if err := db.Create(&users).Error; err != nil {
		t.Fatal(err)
	}
	now := time.Now()
	expiredAt := now.Add(-time.Minute)
	records := []model.SocialActivityRecord{
		{ID: idgen.ID(1201), UserID: users[0].ID, ActivityType: model.SocialActivityAnalysis, Platform: "douyin", SourceURL: "https://www.douyin.com/video/1", Title: "Alice analysis", Status: model.SocialActivitySucceeded, CompletedAt: &now},
		{ID: idgen.ID(1202), UserID: users[0].ID, ActivityType: model.SocialActivityDownload, Platform: "youtube", SourceURL: "https://www.youtube.com/watch?v=alice", Title: "Alice download", Status: model.SocialActivityReady, ExpiresAt: &expiredAt},
		{ID: idgen.ID(1203), UserID: users[1].ID, ActivityType: model.SocialActivityDownload, Platform: "bilibili", SourceURL: "https://www.bilibili.com/video/bob", Title: "Bob secret", Status: model.SocialActivityReady, ExpiresAt: &expiredAt},
	}
	if err := db.Create(&records).Error; err != nil {
		t.Fatal(err)
	}
	h := &handler{db: db}
	router := gin.New()
	router.GET("/records", func(c *gin.Context) {
		c.Set(middleware.CtxUserID, users[0].ID)
		c.Next()
	}, h.activityRecords)
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/records?pageSize=100&userId=1102&userKeyword=bob", nil))
	var result response.Result[response.PageData[ActivityRecordVO]]
	if err := json.Unmarshal(recorder.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	if !result.Success || result.Data.Total != 2 || len(result.Data.Records) != 2 {
		t.Fatalf("unexpected current-user records: %+v body=%s", result, recorder.Body.String())
	}
	if got := recorder.Header().Get("Cache-Control"); got != "private, no-store" {
		t.Fatalf("record response cache control = %q", got)
	}
	foundExpired := false
	for _, row := range result.Data.Records {
		if row.UserID != users[0].ID || row.Title == "Bob secret" {
			t.Fatalf("cross-user activity leaked: %+v", row)
		}
		if row.ID == idgen.ID(1202) && row.Status == model.SocialActivityExpired {
			foundExpired = true
		}
	}
	if !foundExpired {
		t.Fatalf("expired ready record was not normalized: %+v", result.Data.Records)
	}
	var otherUserRecord model.SocialActivityRecord
	if err := db.First(&otherUserRecord, "id = ?", idgen.ID(1203)).Error; err != nil || otherUserRecord.Status != model.SocialActivityReady {
		t.Fatalf("current-user list mutated another user's record: %+v err=%v", otherUserRecord, err)
	}
}

func TestActivityRecordDetailReturnsOwnedSnapshotOnly(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db := activityTestDB(t)
	ownerID := idgen.ID(4101)
	otherID := idgen.ID(4102)
	if err := db.Create(&[]model.User{
		{ID: ownerID, Username: "snapshot-owner", Email: "snapshot-owner@example.com"},
		{ID: otherID, Username: "snapshot-other", Email: "snapshot-other@example.com"},
	}).Error; err != nil {
		t.Fatal(err)
	}
	record := model.SocialActivityRecord{
		ID: idgen.ID(4201), UserID: ownerID, ActivityType: model.SocialActivityAnalysis,
		Platform: "bilibili", SourceURL: "https://space.bilibili.com/1", Title: "Historical account",
		Status: model.SocialActivitySucceeded, SnapshotJSON: `{"platform":"bilibili","platformName":"哔哩哔哩","kind":"account","sourceUrl":"https://space.bilibili.com/1","works":[],"warnings":[],"fetchedAt":1788450000000}`,
		AnalysisRunID: idgen.ID(4301),
	}
	if err := db.Create(&record).Error; err != nil {
		t.Fatal(err)
	}
	h := &handler{db: db}
	router := gin.New()
	router.GET("/records/:id", func(c *gin.Context) {
		c.Set(middleware.CtxUserID, ownerID)
		c.Next()
	}, h.activityRecordDetail)
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/records/4201", nil))
	var result response.Result[ActivityRecordDetailVO]
	if err := json.Unmarshal(recorder.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	if !result.Success || result.Data.ID != record.ID || result.Data.AnalysisRunID != idgen.ID(4301) || !json.Valid(result.Data.Snapshot) {
		t.Fatalf("unexpected owned detail: %+v body=%s", result, recorder.Body.String())
	}

	forbiddenRouter := gin.New()
	forbiddenRouter.GET("/records/:id", func(c *gin.Context) {
		c.Set(middleware.CtxUserID, otherID)
		c.Next()
	}, h.activityRecordDetail)
	forbidden := httptest.NewRecorder()
	forbiddenRouter.ServeHTTP(forbidden, httptest.NewRequest(http.MethodGet, "/records/4201", nil))
	if forbidden.Code != http.StatusNotFound || strings.Contains(forbidden.Body.String(), "Historical account") {
		t.Fatalf("cross-user detail leaked: status=%d body=%s", forbidden.Code, forbidden.Body.String())
	}
}

func TestAdminActivityRecordsSupportUserAndTypeFilters(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db := activityTestDB(t)
	users := []model.User{
		{ID: idgen.ID(2101), Username: "alice-admin-filter", Email: "alice-filter@example.com"},
		{ID: idgen.ID(2102), Username: "bob-admin-filter", Email: "bob-filter@example.com"},
	}
	if err := db.Create(&users).Error; err != nil {
		t.Fatal(err)
	}
	records := []model.SocialActivityRecord{
		{ID: idgen.ID(2201), UserID: users[0].ID, ActivityType: model.SocialActivityDownload, Platform: "youtube", SourceURL: "https://youtube.com/a", Title: "Alice video", Status: model.SocialActivitySucceeded},
		{ID: idgen.ID(2202), UserID: users[1].ID, ActivityType: model.SocialActivityDownload, Platform: "tiktok", SourceURL: "https://tiktok.com/b", Title: "Bob video", Status: model.SocialActivityFailed},
		{ID: idgen.ID(2203), UserID: users[1].ID, ActivityType: model.SocialActivityAnalysis, Platform: "tiktok", SourceURL: "https://tiktok.com/c", Title: "Bob analysis", Status: model.SocialActivitySucceeded},
	}
	if err := db.Create(&records).Error; err != nil {
		t.Fatal(err)
	}
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Request = httptest.NewRequest(http.MethodGet, "/records?type=download&userKeyword=bob-admin&platform=tiktok", nil)
	AdminActivityRecords(c, db)
	var result response.Result[response.PageData[ActivityRecordVO]]
	if err := json.Unmarshal(recorder.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	if !result.Success || result.Data.Total != 1 || len(result.Data.Records) != 1 || result.Data.Records[0].ID != idgen.ID(2202) {
		t.Fatalf("unexpected admin-filtered records: %+v body=%s", result, recorder.Body.String())
	}
	idRecorder := httptest.NewRecorder()
	idContext, _ := gin.CreateTestContext(idRecorder)
	idContext.Request = httptest.NewRequest(http.MethodGet, "/records?type=download&userKeyword=2101", nil)
	AdminActivityRecords(idContext, db)
	var idResult response.Result[response.PageData[ActivityRecordVO]]
	if err := json.Unmarshal(idRecorder.Body.Bytes(), &idResult); err != nil {
		t.Fatal(err)
	}
	if !idResult.Success || idResult.Data.Total != 1 || idResult.Data.Records[0].ID != idgen.ID(2201) {
		t.Fatalf("numeric user filter failed: %+v body=%s", idResult, idRecorder.Body.String())
	}
}

func TestActivityListUsesSnapshotAvatarsWithoutReturningSnapshots(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db := activityTestDB(t)
	ownerID := idgen.ID(5101)
	avatar := "https://i0.hdslb.com/bfs/face/historical.jpg?size=80"
	cases := []struct {
		snapshot string
		want     string
	}{
		{`{"profile":{"avatarUrl":"` + avatar + `"},"works":[{"title":"private-snapshot-work"}]}`, avatar},
		{`{"profile":{"avatarUrl":null}}`, ""},
		{`{"profile":{}}`, ""},
		{`broken-json`, ""},
		{`{"profile":{"avatarUrl":"javascript:alert(1)"}}`, ""},
		{`{"profile":{"avatarUrl":"http://127.0.0.1/private.png"}}`, ""},
		{``, ""},
	}
	for i, tc := range cases {
		record := model.SocialActivityRecord{ID: idgen.ID(5200 + i), UserID: ownerID, ActivityType: model.SocialActivityAnalysis, Kind: "account", Status: model.SocialActivitySucceeded, SnapshotJSON: tc.snapshot}
		if err := db.Create(&record).Error; err != nil {
			t.Fatal(err)
		}
		if got := activityRecordVO(record, model.User{}).AvatarURL; got != tc.want {
			t.Fatalf("detail avatar for case %d: got %q, want %q", i, got, tc.want)
		}
	}
	foreign := model.SocialActivityRecord{ID: idgen.ID(5300), UserID: idgen.ID(5102), ActivityType: model.SocialActivityAnalysis, Status: model.SocialActivitySucceeded, SnapshotJSON: `{"profile":{"avatarUrl":"https://example.com/other-user-avatar.jpg"}}`}
	if err := db.Create(&foreign).Error; err != nil {
		t.Fatal(err)
	}
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Request = httptest.NewRequest(http.MethodGet, "/records", nil)
	writeActivityRecords(c, db, &ownerID, false)
	var result response.Result[response.PageData[ActivityRecordVO]]
	if err := json.Unmarshal(recorder.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	if !result.Success || len(result.Data.Records) != len(cases) {
		t.Fatalf("unexpected list: %s", recorder.Body.String())
	}
	for _, row := range result.Data.Records {
		i := int(row.ID) - 5200
		if i < 0 || i >= len(cases) || row.AvatarURL != cases[i].want {
			t.Fatalf("incorrect avatar or leaked record: %+v", row)
		}
	}
	for _, forbidden := range []string{"snapshot", "private-snapshot-work", "other-user-avatar"} {
		if strings.Contains(recorder.Body.String(), forbidden) {
			t.Fatalf("list leaked %q", forbidden)
		}
	}
}
