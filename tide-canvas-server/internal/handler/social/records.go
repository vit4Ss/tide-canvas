package social

import (
	"encoding/json"
	"errors"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/gin-gonic/gin"
	"go.uber.org/zap"
	"gorm.io/gorm"
	"tidecanvas/internal/handler/points"

	"tidecanvas/internal/middleware"
	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/idgen"
	"tidecanvas/internal/pkg/logger"
	"tidecanvas/internal/pkg/response"
)

const (
	maxActivityPage     = 100_000
	maxActivityPageSize = 100
)

var validActivityStatuses = map[string]bool{
	model.SocialActivityProcessing: true, model.SocialActivityReady: true,
	model.SocialActivityDownloading: true, model.SocialActivitySucceeded: true,
	model.SocialActivityFailed: true, model.SocialActivityExpired: true,
}

type ActivityRecordVO struct {
	PointCost       int        `json:"pointCost"`
	Refunded        bool       `json:"refunded"`
	ID              idgen.ID   `json:"id"`
	UserID          idgen.ID   `json:"userId"`
	UserName        string     `json:"userName"`
	UserEmail       string     `json:"userEmail,omitempty"`
	Type            string     `json:"type"`
	Kind            string     `json:"kind,omitempty"`
	Platform        string     `json:"platform,omitempty"`
	SourceURL       string     `json:"sourceUrl"`
	Title           string     `json:"title,omitempty"`
	AvatarURL       string     `json:"avatarUrl,omitempty"`
	Status          string     `json:"status"`
	Quality         string     `json:"quality,omitempty"`
	DurationSeconds int        `json:"durationSeconds,omitempty"`
	Width           int        `json:"width,omitempty"`
	Height          int        `json:"height,omitempty"`
	EstimatedBytes  int64      `json:"estimatedBytes,omitempty"`
	DownloadedBytes int64      `json:"downloadedBytes,omitempty"`
	AnalysisRunID   idgen.ID   `json:"analysisRunId,omitempty"`
	ErrorMessage    string     `json:"errorMessage,omitempty"`
	ExpiresAt       *time.Time `json:"expiresAt,omitempty"`
	CreateTime      time.Time  `json:"createTime"`
	UpdateTime      time.Time  `json:"updateTime"`
	CompletedAt     *time.Time `json:"completedAt,omitempty"`
}

type ActivityRecordDetailVO struct {
	ActivityRecordVO
	Download *videoDownloadResolveVO `json:"download,omitempty"`
	Snapshot json.RawMessage         `json:"snapshot,omitempty"`
}

func parseActivityPositive(raw string, fallback int) int {
	value, err := strconv.Atoi(strings.TrimSpace(raw))
	if err != nil || value <= 0 {
		return fallback
	}
	return value
}

func parseActivityDate(raw string, end bool) (*time.Time, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil, nil
	}
	value, err := time.ParseInLocation("2006-01-02", raw, time.Local)
	if err != nil {
		return nil, err
	}
	if end {
		value = value.AddDate(0, 0, 1)
	}
	return &value, nil
}

func activityString(raw string, maxRunes int) string {
	raw = strings.Join(strings.Fields(strings.TrimSpace(raw)), " ")
	if maxRunes > 0 && utf8.RuneCountInString(raw) > maxRunes {
		return string([]rune(raw)[:maxRunes])
	}
	return raw
}

func activityUserName(user model.User, fallback idgen.ID) string {
	for _, value := range []string{user.Nickname, user.Username, user.Email} {
		if value = strings.TrimSpace(value); value != "" {
			return value
		}
	}
	return fallback.String()
}

func (h *handler) beginActivity(record model.SocialActivityRecord) *model.SocialActivityRecord {
	if h == nil || h.db == nil || record.UserID == 0 {
		return nil
	}
	if record.Status == "" {
		record.Status = model.SocialActivityProcessing
	}
	if err := h.db.Create(&record).Error; err != nil {
		logger.L().Warn("failed to create social activity record", zap.Error(err))
		return nil
	}
	return &record
}

func (h *handler) completeDownloadActivity(record *model.SocialActivityRecord, downloadedBytes int64) {
	if h == nil || h.db == nil || record == nil || record.ID == 0 || record.UserID == 0 || downloadedBytes <= 0 {
		return
	}
	if err := h.db.Model(&model.SocialActivityRecord{}).
		Where("id = ? AND user_id = ? AND activity_type = ? AND status = ? AND refunded = ?", record.ID, record.UserID, model.SocialActivityDownload, model.SocialActivityDownloading, false).
		Updates(map[string]any{"status": model.SocialActivitySucceeded, "downloaded_bytes": downloadedBytes, "error_message": "", "completed_at": time.Now()}).Error; err != nil {
		logger.L().Warn("failed to update social activity record", zap.String("recordId", record.ID.String()), zap.Error(err))
	}
}

func (h *handler) failActivity(record *model.SocialActivityRecord, message string) {
	if h == nil || h.db == nil || record == nil || record.ID == 0 || record.UserID == 0 {
		return
	}
	if err := points.FailSocial(h.db, record.ID, activityString(message, 1000), false); err != nil {
		logger.L().Warn("failed to mark social activity as failed", zap.String("recordId", record.ID.String()), zap.Error(err))
	}
}

func (h *handler) activityRecords(c *gin.Context) {
	userID := middleware.CurrentUserID(c)
	writeActivityRecords(c, h.db, &userID, false)
}

func (h *handler) activityRecordDetail(c *gin.Context) {
	c.Header("Cache-Control", "private, no-store")
	recordID, err := idgen.Parse(strings.TrimSpace(c.Param("id")))
	if err != nil || recordID == 0 {
		response.Fail(c, response.CodeBadRequest, "记录 ID 无效")
		return
	}
	userID := middleware.CurrentUserID(c)
	closeAbandonedDownloads(h.db, &userID, time.Now())
	var record model.SocialActivityRecord
	if err := h.db.Where("id = ? AND user_id = ?", recordID, userID).First(&record).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			response.Fail(c, response.CodeNotFound, "记录不存在")
			return
		}
		response.Fail(c, response.CodeServerError, "failed to load social activity record")
		return
	}
	var user model.User
	_ = h.db.Unscoped().First(&user, "id = ?", userID).Error
	detail := ActivityRecordDetailVO{ActivityRecordVO: activityRecordVO(record, user)}
	if record.ActivityType == model.SocialActivityDownload && record.PointCost > 0 && !record.Refunded && record.Status == model.SocialActivityReady && record.ExpiresAt != nil && record.ExpiresAt.After(time.Now()) {
		var download videoDownloadResolveVO
		if json.Unmarshal([]byte(record.SnapshotJSON), &download) == nil && download.RecordID == record.ID {
			detail.Download = &download
		}
	}
	if raw := strings.TrimSpace(record.SnapshotJSON); record.ActivityType == model.SocialActivityAnalysis && raw != "" && json.Valid([]byte(raw)) {
		detail.Snapshot = json.RawMessage(raw)
	}
	response.OK(c, detail)
}

// AdminActivityRecords writes the administrator-wide list. The /api/admin
// group supplies authentication and the analysis_records module permission.
func AdminActivityRecords(c *gin.Context, db *gorm.DB) {
	writeActivityRecords(c, db, nil, true)
}

// A killed backend cannot run its failure defer. Recover those records only
// after the hard preparation+stream deadline, with a grace period; the short
// download-ticket expiry must never terminate an already-authorized transfer.
func closeAbandonedDownloads(db *gorm.DB, ownerID *idgen.ID, now time.Time) {
	if db == nil {
		return
	}
	if err := points.ReconcileSocialDownloads(db, ownerID, now); err != nil {
		logger.L().Error("failed to reconcile paid download records", zap.Error(err))
	}
	tx := db.Model(&model.SocialActivityRecord{}).Where(
		"point_cost = 0 AND activity_type = ? AND status = ? AND update_time < ?",
		model.SocialActivityDownload, model.SocialActivityDownloading, now.Add(-videoDownloadMaxTime-time.Minute),
	)
	if ownerID != nil {
		tx = tx.Where("user_id = ?", *ownerID)
	}
	if err := tx.Updates(map[string]any{
		"status": model.SocialActivityFailed, "error_message": "下载已中断或超时，请重新解析后下载", "completed_at": now,
	}).Error; err != nil {
		logger.L().Warn("failed to close abandoned video downloads", zap.Error(err))
	}
}

func writeActivityRecords(c *gin.Context, db *gorm.DB, ownerID *idgen.ID, allowUserFilter bool) {
	c.Header("Cache-Control", "private, no-store")
	page := parseActivityPositive(c.Query("pageNum"), 1)
	pageSize := parseActivityPositive(c.Query("pageSize"), 20)
	if page > maxActivityPage {
		response.Fail(c, response.CodeBadRequest, "页码超出允许范围")
		return
	}
	if pageSize > maxActivityPageSize {
		pageSize = maxActivityPageSize
	}
	recordType := strings.ToLower(strings.TrimSpace(c.Query("type")))
	if recordType != "" && recordType != model.SocialActivityAnalysis && recordType != model.SocialActivityDownload {
		response.Fail(c, response.CodeBadRequest, "记录类型只能是 analysis 或 download")
		return
	}
	status := strings.ToLower(strings.TrimSpace(c.Query("status")))
	if status != "" && !validActivityStatuses[status] {
		response.Fail(c, response.CodeBadRequest, "记录状态无效")
		return
	}
	platform := strings.ToLower(strings.TrimSpace(c.Query("platform")))
	if len(platform) > 32 {
		response.Fail(c, response.CodeBadRequest, "平台筛选值过长")
		return
	}
	keyword := activityString(c.Query("keyword"), 100)
	userKeyword := activityString(c.Query("userKeyword"), 100)
	start, startErr := parseActivityDate(c.Query("startDate"), false)
	end, endErr := parseActivityDate(c.Query("endDate"), true)
	if startErr != nil || endErr != nil || (start != nil && end != nil && !start.Before(*end)) {
		response.Fail(c, response.CodeBadRequest, "日期范围无效")
		return
	}

	expiryNow := time.Now()
	closeAbandonedDownloads(db, ownerID, expiryNow)
	expiryTx := db.Model(&model.SocialActivityRecord{}).
		Where("point_cost = 0 AND activity_type = ? AND status = ? AND expires_at IS NOT NULL AND expires_at < ?", model.SocialActivityDownload, model.SocialActivityReady, expiryNow)
	if ownerID != nil {
		expiryTx = expiryTx.Where("user_id = ?", *ownerID)
	}
	if err := expiryTx.Updates(map[string]any{
		"status": model.SocialActivityExpired, "error_message": "下载地址已过期", "completed_at": expiryNow,
	}).Error; err != nil {
		logger.L().Warn("failed to expire stale download records", zap.Error(err))
	}

	tx := db.Model(&model.SocialActivityRecord{})
	if ownerID != nil {
		tx = tx.Where("user_id = ?", *ownerID)
		// Old versions logged every successful preview/quality switch. Keep those
		// rows available to administrators, but don't present them as downloads.
		tx = tx.Where("point_cost > 0 OR activity_type <> ? OR status NOT IN ?", model.SocialActivityDownload,
			[]string{model.SocialActivityProcessing, model.SocialActivityReady, model.SocialActivityExpired})
	} else if allowUserFilter {
		if raw := strings.TrimSpace(c.Query("userId")); raw != "" {
			userID, err := idgen.Parse(raw)
			if err != nil || userID == 0 {
				response.Fail(c, response.CodeBadRequest, "用户 ID 无效")
				return
			}
			tx = tx.Where("user_id = ?", userID)
		}
		if userKeyword != "" {
			pattern := "%" + userKeyword + "%"
			users := db.Model(&model.User{}).Select("id").Where(
				"username LIKE ? OR nickname LIKE ? OR email LIKE ?", pattern, pattern, pattern,
			)
			if parsedUserID, err := idgen.Parse(userKeyword); err == nil && parsedUserID != 0 {
				tx = tx.Where("(user_id = ? OR user_id IN (?))", parsedUserID, users)
			} else {
				tx = tx.Where("user_id IN (?)", users)
			}
		}
	}
	if recordType != "" {
		tx = tx.Where("activity_type = ?", recordType)
	}
	if status != "" {
		tx = tx.Where("status = ?", status)
	}
	if platform != "" {
		tx = tx.Where("platform = ?", platform)
	}
	if keyword != "" {
		pattern := "%" + keyword + "%"
		tx = tx.Where("title LIKE ? OR source_url LIKE ?", pattern, pattern)
	}
	if start != nil {
		tx = tx.Where("create_time >= ?", *start)
	}
	if end != nil {
		tx = tx.Where("create_time < ?", *end)
	}

	var total int64
	if err := tx.Count(&total).Error; err != nil {
		response.Fail(c, response.CodeServerError, "failed to count social activity records")
		return
	}
	var records []model.SocialActivityRecord
	if err := tx.Omit("snapshot_json").Order("create_time DESC, id DESC").Offset((page - 1) * pageSize).Limit(pageSize).Find(&records).Error; err != nil {
		response.Fail(c, response.CodeServerError, "failed to list social activity records")
		return
	}
	userIDs := make([]idgen.ID, 0, len(records))
	seen := make(map[idgen.ID]bool, len(records))
	for i := range records {
		if !seen[records[i].UserID] {
			seen[records[i].UserID] = true
			userIDs = append(userIDs, records[i].UserID)
		}
	}
	usersByID := make(map[idgen.ID]model.User, len(userIDs))
	if len(userIDs) > 0 {
		var users []model.User
		if err := db.Unscoped().Where("id IN ?", userIDs).Find(&users).Error; err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
			response.Fail(c, response.CodeServerError, "failed to load activity record users")
			return
		}
		for i := range users {
			usersByID[users[i].ID] = users[i]
		}
	}
	rows := make([]ActivityRecordVO, 0, len(records))
	avatars := activityRecordAvatars(db, records)
	for i := range records {
		record := records[i]
		user := usersByID[record.UserID]
		row := activityRecordVO(record, user)
		row.AvatarURL = avatars[record.ID]
		rows = append(rows, row)
	}
	response.Page(c, rows, total, page, pageSize)
}

func activityRecordVO(record model.SocialActivityRecord, user model.User) ActivityRecordVO {
	var snapshot struct {
		Profile struct {
			AvatarURL string `json:"avatarUrl"`
		} `json:"profile"`
	}
	avatarURL := ""
	if record.ActivityType == model.SocialActivityAnalysis && json.Unmarshal([]byte(record.SnapshotJSON), &snapshot) == nil {
		avatarURL = validHTTPURL(snapshot.Profile.AvatarURL)
	}
	return ActivityRecordVO{
		PointCost: record.PointCost, Refunded: record.Refunded,
		ID: record.ID, UserID: record.UserID, UserName: activityUserName(user, record.UserID), UserEmail: user.Email,
		Type: record.ActivityType, Kind: record.Kind, Platform: record.Platform, SourceURL: record.SourceURL,
		Title: record.Title, AvatarURL: avatarURL, Status: record.Status, Quality: record.Quality,
		DurationSeconds: record.DurationSeconds, Width: record.Width, Height: record.Height,
		EstimatedBytes: record.EstimatedBytes, DownloadedBytes: record.DownloadedBytes, AnalysisRunID: record.AnalysisRunID,
		ErrorMessage: activityString(record.ErrorMessage, 1000), ExpiresAt: record.ExpiresAt, CreateTime: record.CreateTime,
		UpdateTime: record.UpdateTime, CompletedAt: record.CompletedAt,
	}
}

// Extract only avatars for this already-authorized page, including old records.
// Keep large work snapshots out of list responses and avoid per-record requests.
func activityRecordAvatars(db *gorm.DB, records []model.SocialActivityRecord) map[idgen.ID]string {
	avatars := make(map[idgen.ID]string)
	ids := make([]idgen.ID, 0, len(records))
	for _, record := range records {
		if record.ActivityType == model.SocialActivityAnalysis {
			ids = append(ids, record.ID)
		}
	}
	if len(ids) == 0 {
		return avatars
	}
	extract := "JSON_EXTRACT(CASE WHEN JSON_VALID(snapshot_json) THEN snapshot_json ELSE '{}' END, '$.profile.avatarUrl')"
	if db.Dialector.Name() == "mysql" {
		extract = "JSON_UNQUOTE(" + extract + ")"
	}
	var previews []struct {
		ID        idgen.ID
		AvatarURL string
	}
	if err := db.Model(&model.SocialActivityRecord{}).
		Select("id, COALESCE("+extract+", '') AS avatar_url").Where("id IN ?", ids).Scan(&previews).Error; err != nil {
		logger.L().Warn("failed to load social activity avatars", zap.Error(err))
		return avatars
	}
	for _, preview := range previews {
		avatars[preview.ID] = validHTTPURL(preview.AvatarURL)
	}
	return avatars
}
