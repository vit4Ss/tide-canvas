package chat

import (
	"errors"
	"strings"
	"sync"
	"testing"
	"time"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"

	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/idgen"
)

func openPersistTurnTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(
		sqlite.Open("file:"+t.Name()+"?mode=memory&cache=shared"),
		&gorm.Config{Logger: logger.Default.LogMode(logger.Silent)},
	)
	if err != nil {
		if strings.Contains(strings.ToLower(err.Error()), "cgo") {
			t.Skip("sqlite driver requires CGO in this environment")
		}
		t.Fatalf("open sqlite: %v", err)
	}
	if err := db.AutoMigrate(&model.AiTask{}, &model.IMConversation{}, &model.IMMessage{}); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatalf("sql db: %v", err)
	}
	// One connection gives SQLite deterministic transaction serialization; the
	// production MySQL path additionally serializes on SELECT ... FOR UPDATE.
	sqlDB.SetMaxOpenConns(1)
	t.Cleanup(func() { _ = sqlDB.Close() })
	return db
}

func seedPersistTurnConversation(t *testing.T, db *gorm.DB, ownerID idgen.ID) idgen.ID {
	t.Helper()
	conversationID := idgen.Next()
	if err := db.Create(&model.IMConversation{
		BaseModel: model.BaseModel{ID: conversationID},
		Type:      "ai",
		OwnerID:   ownerID,
	}).Error; err != nil {
		t.Fatalf("create conversation: %v", err)
	}
	return conversationID
}

func seedPersistTurnTask(t *testing.T, db *gorm.DB, ownerID idgen.ID) idgen.ID {
	t.Helper()
	taskID := idgen.Next()
	if err := db.Create(&model.AiTask{ID: taskID, UserID: ownerID, Handler: "text_to_image"}).Error; err != nil {
		t.Fatalf("create task: %v", err)
	}
	return taskID
}

func newPersistTurnMessages(conversationID, ownerID, taskID idgen.ID) (*model.IMMessage, *model.IMMessage) {
	return &model.IMMessage{
			ConversationID: conversationID,
			SenderID:       ownerID,
			ContentType:    "text",
			Content:        "draw a lighthouse",
			Params:         `{"model":"test-image"}`,
		}, &model.IMMessage{
			ConversationID: conversationID,
			SenderID:       assistantSenderID,
			ContentType:    "image",
			TaskID:         &taskID,
		}
}

func TestCreateTurnRetryReturnsExistingPair(t *testing.T) {
	db := openPersistTurnTestDB(t)
	repository := newRepo(db)
	ownerID := idgen.Next()
	conversationID := seedPersistTurnConversation(t, db, ownerID)
	taskID := seedPersistTurnTask(t, db, ownerID)

	firstUser, firstAI := newPersistTurnMessages(conversationID, ownerID, taskID)
	if err := repository.createTurn(ownerID, taskID, firstUser, firstAI); err != nil {
		t.Fatalf("first createTurn: %v", err)
	}
	retryUser, retryAI := newPersistTurnMessages(conversationID, ownerID, taskID)
	if err := repository.createTurn(ownerID, taskID, retryUser, retryAI); err != nil {
		t.Fatalf("retry createTurn: %v", err)
	}
	if retryUser.ID != firstUser.ID || retryAI.ID != firstAI.ID {
		t.Fatalf("retry returned a different pair: first=(%s,%s) retry=(%s,%s)", firstUser.ID.String(), firstAI.ID.String(), retryUser.ID.String(), retryAI.ID.String())
	}

	var count int64
	if err := db.Model(&model.IMMessage{}).Where("conversation_id = ?", conversationID).Count(&count).Error; err != nil {
		t.Fatalf("count messages: %v", err)
	}
	if count != 2 {
		t.Fatalf("message count = %d, want 2", count)
	}
}

func TestCreateTurnConcurrentRetriesCreateOnePair(t *testing.T) {
	db := openPersistTurnTestDB(t)
	repository := newRepo(db)
	ownerID := idgen.Next()
	conversationID := seedPersistTurnConversation(t, db, ownerID)
	taskID := seedPersistTurnTask(t, db, ownerID)

	const workers = 2
	start := make(chan struct{})
	errs := make(chan error, workers)
	var wg sync.WaitGroup
	for range workers {
		wg.Add(1)
		go func() {
			defer wg.Done()
			userMsg, aiMsg := newPersistTurnMessages(conversationID, ownerID, taskID)
			<-start
			errs <- repository.createTurn(ownerID, taskID, userMsg, aiMsg)
		}()
	}
	close(start)
	wg.Wait()
	close(errs)
	for err := range errs {
		if err != nil {
			t.Fatalf("concurrent createTurn: %v", err)
		}
	}

	var total, assistant int64
	if err := db.Model(&model.IMMessage{}).Where("conversation_id = ?", conversationID).Count(&total).Error; err != nil {
		t.Fatalf("count messages: %v", err)
	}
	if err := db.Model(&model.IMMessage{}).Where("conversation_id = ? AND task_id = ?", conversationID, taskID).Count(&assistant).Error; err != nil {
		t.Fatalf("count assistant messages: %v", err)
	}
	if total != 2 || assistant != 1 {
		t.Fatalf("messages total=%d assistant=%d, want total=2 assistant=1", total, assistant)
	}
}

func TestCreateTurnWaitsForActiveTextLeaseBeforeInsert(t *testing.T) {
	db := openPersistTurnTestDB(t)
	repository := newRepo(db)
	ownerID := idgen.Next()
	conversationID := seedPersistTurnConversation(t, db, ownerID)
	taskID := seedPersistTurnTask(t, db, ownerID)

	requestID := "active-text-before-media"
	leaseUntil, leaseToken := time.Now().Add(time.Minute), idgen.Next()
	if err := db.Create(&model.IMMessage{
		ConversationID:    conversationID,
		SenderID:          ownerID,
		ContentType:       "text",
		Content:           "answer this first",
		ClientRequestID:   &requestID,
		RequestLeaseUntil: &leaseUntil,
		RequestLeaseToken: &leaseToken,
	}).Error; err != nil {
		t.Fatalf("create active text request: %v", err)
	}

	userMsg, aiMsg := newPersistTurnMessages(conversationID, ownerID, taskID)
	if err := repository.createTurn(ownerID, taskID, userMsg, aiMsg); !errors.Is(err, errConversationBusy) {
		t.Fatalf("createTurn during text lease = %v, want errConversationBusy", err)
	}
	var mediaRows int64
	if err := db.Model(&model.IMMessage{}).
		Where("conversation_id = ? AND task_id = ?", conversationID, taskID).
		Count(&mediaRows).Error; err != nil {
		t.Fatalf("count media rows: %v", err)
	}
	if mediaRows != 0 {
		t.Fatalf("media rows = %d, want 0 while text lease is live", mediaRows)
	}
}

func TestCreateTurnRetryReturnsExistingPairWhileAnotherTextLeaseIsActive(t *testing.T) {
	db := openPersistTurnTestDB(t)
	repository := newRepo(db)
	ownerID := idgen.Next()
	conversationID := seedPersistTurnConversation(t, db, ownerID)
	taskID := seedPersistTurnTask(t, db, ownerID)

	firstUser, firstAI := newPersistTurnMessages(conversationID, ownerID, taskID)
	if err := repository.createTurn(ownerID, taskID, firstUser, firstAI); err != nil {
		t.Fatalf("first createTurn: %v", err)
	}
	requestID := "later-active-text"
	leaseUntil, leaseToken := time.Now().Add(time.Minute), idgen.Next()
	if err := db.Create(&model.IMMessage{
		ConversationID:    conversationID,
		SenderID:          ownerID,
		ContentType:       "text",
		Content:           "later text request",
		ClientRequestID:   &requestID,
		RequestLeaseUntil: &leaseUntil,
		RequestLeaseToken: &leaseToken,
	}).Error; err != nil {
		t.Fatalf("create later active text request: %v", err)
	}

	retryUser, retryAI := newPersistTurnMessages(conversationID, ownerID, taskID)
	if err := repository.createTurn(ownerID, taskID, retryUser, retryAI); err != nil {
		t.Fatalf("idempotent retry during later text lease: %v", err)
	}
	if retryUser.ID != firstUser.ID || retryAI.ID != firstAI.ID {
		t.Fatalf("retry returned different pair: first=(%s,%s) retry=(%s,%s)",
			firstUser.ID.String(), firstAI.ID.String(), retryUser.ID.String(), retryAI.ID.String())
	}
}
