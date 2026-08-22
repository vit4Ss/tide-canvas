package chat

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/schema"

	"github.com/gin-gonic/gin"

	"tidecanvas/internal/handler/points"
	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/idgen"
)

func textRequestID(value string) *string { return &value }

func TestTextRequestUniqueIndexFencesOneMessagePerRole(t *testing.T) {
	db := openPersistTurnTestDB(t)
	conversationID, ownerID := idgen.Next(), idgen.Next()
	requestID := "chat-request-1"

	user := &model.IMMessage{
		ConversationID:  conversationID,
		SenderID:        ownerID,
		ContentType:     "text",
		Content:         "hello",
		ClientRequestID: textRequestID(requestID),
	}
	if err := db.Create(user).Error; err != nil {
		t.Fatalf("insert first user row: %v", err)
	}

	duplicateUser := &model.IMMessage{
		ConversationID:  conversationID,
		SenderID:        ownerID,
		ContentType:     "text",
		Content:         "must not be inserted",
		ClientRequestID: textRequestID(requestID),
	}
	if err := db.Create(duplicateUser).Error; err == nil {
		t.Fatal("duplicate user row unexpectedly bypassed the request-id fence")
	}

	// The assistant uses the same request id but a different sender sentinel;
	// the composite key deliberately permits the other half of the turn.
	assistant := &model.IMMessage{
		ConversationID:  conversationID,
		SenderID:        assistantSenderID,
		ContentType:     "text",
		Content:         "hi",
		ClientRequestID: textRequestID(requestID),
	}
	if err := db.Create(assistant).Error; err != nil {
		t.Fatalf("insert assistant row for the same request: %v", err)
	}

	// Legacy/non-stream messages keep a NULL request id. SQL unique indexes
	// permit multiple NULL values, so adding the fence must not break them.
	for i := 0; i < 2; i++ {
		legacy := &model.IMMessage{
			ConversationID: conversationID,
			SenderID:       ownerID,
			ContentType:    "text",
			Content:        "legacy",
		}
		if err := db.Create(legacy).Error; err != nil {
			t.Fatalf("insert legacy row %d: %v", i, err)
		}
	}
}

func TestMessageByClientRequestIsConversationAndRoleScoped(t *testing.T) {
	db := openPersistTurnTestDB(t)
	repository := newRepo(db)
	conversationID, otherConversationID, ownerID := idgen.Next(), idgen.Next(), idgen.Next()
	requestID := "chat-request-lookup"

	want := &model.IMMessage{
		ConversationID:  conversationID,
		SenderID:        ownerID,
		ContentType:     "text",
		Content:         "owned request",
		ClientRequestID: textRequestID(requestID),
	}
	if err := db.Create(want).Error; err != nil {
		t.Fatalf("insert request row: %v", err)
	}
	if err := db.Create(&model.IMMessage{
		ConversationID:  otherConversationID,
		SenderID:        ownerID,
		ContentType:     "text",
		Content:         "same key, another conversation",
		ClientRequestID: textRequestID(requestID),
	}).Error; err != nil {
		t.Fatalf("insert same request id in another conversation: %v", err)
	}

	got, err := repository.messageByClientRequest(conversationID, ownerID, requestID)
	if err != nil {
		t.Fatalf("lookup request row: %v", err)
	}
	if got == nil || got.ID != want.ID {
		t.Fatalf("lookup returned %#v, want message %s", got, want.ID.String())
	}

	missing, err := repository.messageByClientRequest(conversationID, assistantSenderID, requestID)
	if err != nil {
		t.Fatalf("lookup missing assistant row: %v", err)
	}
	if missing != nil {
		t.Fatalf("assistant lookup returned user row %s", missing.ID.String())
	}
}

func TestTextRequestIndexExistsAfterMigration(t *testing.T) {
	db := openPersistTurnTestDB(t)
	if !db.Migrator().HasIndex(&model.IMMessage{}, "idx_im_message_request") {
		t.Fatal("idx_im_message_request was not created")
	}
}

func TestTextRequestIndexSchemaIsNullableCompositeUnique(t *testing.T) {
	parsed, err := schema.Parse(&model.IMMessage{}, &sync.Map{}, schema.NamingStrategy{})
	if err != nil {
		t.Fatalf("parse IMMessage schema: %v", err)
	}
	index, ok := parsed.ParseIndexes()["idx_im_message_request"]
	if !ok {
		t.Fatal("idx_im_message_request is absent from the GORM schema")
	}
	if index.Class != "UNIQUE" {
		t.Fatalf("index class = %q, want UNIQUE", index.Class)
	}
	wantColumns := []string{"conversation_id", "sender_id", "client_request_id"}
	if len(index.Fields) != len(wantColumns) {
		t.Fatalf("index columns = %d, want %d", len(index.Fields), len(wantColumns))
	}
	for i, want := range wantColumns {
		if got := index.Fields[i].DBName; got != want {
			t.Fatalf("index column %d = %q, want %q", i, got, want)
		}
	}
	requestField := parsed.LookUpField("ClientRequestID")
	if requestField == nil {
		t.Fatal("ClientRequestID field is absent")
	}
	if requestField.NotNull {
		t.Fatal("ClientRequestID must stay nullable so legacy messages can coexist")
	}
	if got := requestField.TagSettings["TYPE"]; got != "varchar(96)" {
		t.Fatalf("ClientRequestID SQL type = %q, want varchar(96)", got)
	}
	for _, fieldName := range []string{"RequestLeaseUntil", "RequestLeaseToken", "RequestChargeRefID"} {
		field := parsed.LookUpField(fieldName)
		if field == nil {
			t.Fatalf("%s field is absent", fieldName)
		}
		if field.NotNull {
			t.Fatalf("%s must remain nullable for legacy rows", fieldName)
		}
	}
	if snapshot := parsed.LookUpField("RequestSnapshot"); snapshot == nil || snapshot.TagSettings["TYPE"] != "longtext" {
		t.Fatalf("RequestSnapshot must be private longtext recovery state, got %#v", snapshot)
	}
}

func TestClientRequestIDMustBeCanonical(t *testing.T) {
	valid := []string{"", "chat-request-1", strings.Repeat("界", 96)}
	for _, value := range valid {
		if err := validateClientRequestID(value); err != nil {
			t.Fatalf("validateClientRequestID(%q) = %v", value, err)
		}
	}
	invalid := []string{" ", "\trequest", "request\n", strings.Repeat("a", 97)}
	for _, value := range invalid {
		if err := validateClientRequestID(value); !errors.Is(err, errInvalidClientRequestID) {
			t.Fatalf("validateClientRequestID(%q) = %v, want errInvalidClientRequestID", value, err)
		}
		// Validation is the first service operation; an invalid non-empty key
		// cannot reach a nil repo and silently degrade to the legacy path.
		if _, err := (&service{}).streamMessage(context.Background(), 1, 1, "hello", nil, "", "", false, value, nil); !errors.Is(err, errInvalidClientRequestID) {
			t.Fatalf("streamMessage(%q) = %v, want errInvalidClientRequestID", value, err)
		}
	}
}

func TestStreamHandlerRejectsNonCanonicalClientRequestIDBeforeSSE(t *testing.T) {
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Params = gin.Params{{Key: "id", Value: "1"}}
	c.Request = httptest.NewRequest(http.MethodPost, "/api/im/conversations/1/stream", strings.NewReader(`{
		"content":"hello",
		"clientRequestId":" request-with-padding "
	}`))
	c.Request.Header.Set("Content-Type", "application/json")

	newHandler(nil).streamMessage(c)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", w.Code)
	}
	if got := w.Header().Get("Content-Type"); strings.Contains(got, "text/event-stream") {
		t.Fatalf("invalid request opened SSE response: %q", got)
	}
	if !strings.Contains(w.Body.String(), "invalid clientRequestId") {
		t.Fatalf("response body = %s", w.Body.String())
	}
}

func TestStreamMessageReplayReturnsPersistedAssistant(t *testing.T) {
	db := openPersistTurnTestDB(t)
	if err := db.AutoMigrate(&model.IMConversation{}); err != nil {
		t.Fatalf("migrate conversation: %v", err)
	}
	ownerID, conversationID := idgen.Next(), idgen.Next()
	if err := db.Create(&model.IMConversation{
		BaseModel: model.BaseModel{ID: conversationID},
		Type:      "ai",
		OwnerID:   ownerID,
	}).Error; err != nil {
		t.Fatalf("create conversation: %v", err)
	}

	svc := &service{
		repo:          newRepo(db),
		historyLimit:  20,
		ctxTokenLimit: 32000,
		live:          make(map[liveReplyKey]*liveReply),
	}
	requestID := "chat-request-replay"
	var firstDeltas int
	first, err := svc.streamMessage(
		context.Background(), conversationID, ownerID, "hello", nil, "", "", false, requestID,
		func(string) { firstDeltas++ },
	)
	if err != nil {
		t.Fatalf("first streamMessage: %v", err)
	}
	if firstDeltas == 0 {
		t.Fatal("first request did not generate a reply")
	}

	var replayDeltas int
	replayed, err := svc.streamMessage(
		context.Background(), conversationID, ownerID, "different payload is ignored for the same key", nil, "", "", false, requestID,
		func(string) { replayDeltas++ },
	)
	if err != nil {
		t.Fatalf("replay streamMessage: %v", err)
	}
	if replayDeltas != 0 {
		t.Fatalf("replay generated %d new deltas", replayDeltas)
	}
	if replayed.ID != first.ID || replayed.Content != first.Content {
		t.Fatalf("replay returned a different assistant: first=%s replay=%s", first.ID.String(), replayed.ID.String())
	}

	var count int64
	if err := db.Model(&model.IMMessage{}).
		Where("conversation_id = ?", conversationID).
		Count(&count).Error; err != nil {
		t.Fatalf("count messages: %v", err)
	}
	if count != 2 {
		t.Fatalf("message count = %d, want one user and one assistant", count)
	}
}

func TestTextRequestSnapshotPreservesWebSearch(t *testing.T) {
	raw := encodeTextRequestSnapshot(textRequestSnapshot{Version: 1, Model: "gpt", WebSearch: true})
	got, ok := parseTextRequestSnapshot(raw)
	if !ok || !got.WebSearch {
		t.Fatalf("web search was lost in recovery snapshot: %#v, ok=%v", got, ok)
	}
}

func TestStreamMessageRetryJoinsPersistedUser(t *testing.T) {
	db := openPersistTurnTestDB(t)
	if err := db.AutoMigrate(&model.IMConversation{}); err != nil {
		t.Fatalf("migrate conversation: %v", err)
	}
	ownerID, conversationID := idgen.Next(), idgen.Next()
	if err := db.Create(&model.IMConversation{
		BaseModel: model.BaseModel{ID: conversationID},
		Type:      "ai",
		OwnerID:   ownerID,
	}).Error; err != nil {
		t.Fatalf("create conversation: %v", err)
	}
	requestID := "chat-request-pending"
	leaseUntil := time.Now().Add(time.Minute)
	if err := db.Create(&model.IMMessage{
		ConversationID:    conversationID,
		SenderID:          ownerID,
		ContentType:       "text",
		Content:           "already accepted",
		ClientRequestID:   textRequestID(requestID),
		RequestLeaseUntil: &leaseUntil,
	}).Error; err != nil {
		t.Fatalf("create accepted user row: %v", err)
	}

	svc := &service{
		repo:          newRepo(db),
		historyLimit:  20,
		ctxTokenLimit: 32000,
		live:          make(map[liveReplyKey]*liveReply),
	}
	_, err := svc.streamMessage(
		context.Background(), conversationID, ownerID, "retry", nil, "", "", false, requestID, nil,
	)
	if !errors.Is(err, errTextTurnInProgress) {
		t.Fatalf("retry error = %v, want errTextTurnInProgress", err)
	}

	var count int64
	if err := db.Model(&model.IMMessage{}).
		Where("conversation_id = ?", conversationID).
		Count(&count).Error; err != nil {
		t.Fatalf("count messages: %v", err)
	}
	if count != 1 {
		t.Fatalf("retry inserted another message; count = %d", count)
	}
}

func TestClaimTextRequestDebitsOnlyTheWinningInstance(t *testing.T) {
	db := openPersistTurnTestDB(t)
	if err := db.AutoMigrate(&model.IMConversation{}, &model.User{}, &model.PointRecord{}); err != nil {
		t.Fatalf("migrate billing rows: %v", err)
	}
	ownerID, conversationID := idgen.Next(), idgen.Next()
	if err := db.Create(&model.IMConversation{BaseModel: model.BaseModel{ID: conversationID}, Type: "ai", OwnerID: ownerID}).Error; err != nil {
		t.Fatalf("create conversation: %v", err)
	}
	if err := db.Create(&model.User{ID: ownerID, Username: "text-claim-winner", Points: 5}).Error; err != nil {
		t.Fatalf("create user: %v", err)
	}

	const workers = 2
	requestID := "chat-request-atomic-charge"
	start := make(chan struct{})
	type result struct {
		claimed bool
		err     error
	}
	results := make(chan result, workers)
	var debitAttempts atomic.Int32
	var wg sync.WaitGroup
	for range workers {
		wg.Add(1)
		go func() {
			defer wg.Done()
			msg := &model.IMMessage{
				ConversationID:  conversationID,
				SenderID:        ownerID,
				ContentType:     "text",
				Content:         "one paid request",
				ClientRequestID: textRequestID(requestID),
			}
			refID := idgen.Next()
			<-start
			claimed, err := newRepo(db).claimTextRequest(context.Background(), msg, func(tx *gorm.DB) error {
				debitAttempts.Add(1)
				return points.Consume(tx, ownerID, 5, "atomic chat claim", refID)
			})
			results <- result{claimed: claimed, err: err}
		}()
	}
	close(start)
	wg.Wait()
	close(results)

	winners := 0
	for result := range results {
		if result.err != nil {
			t.Fatalf("claimTextRequest: %v", result.err)
		}
		if result.claimed {
			winners++
		}
	}
	if winners != 1 || debitAttempts.Load() != 1 {
		t.Fatalf("winners/debit attempts = %d/%d, want 1/1", winners, debitAttempts.Load())
	}

	var user model.User
	if err := db.Select("id", "points").First(&user, "id = ?", ownerID).Error; err != nil {
		t.Fatalf("load user: %v", err)
	}
	if user.Points != 0 {
		t.Fatalf("balance = %d, want 0 after exactly one debit", user.Points)
	}
	var messages, consumes int64
	if err := db.Model(&model.IMMessage{}).Where("conversation_id = ?", conversationID).Count(&messages).Error; err != nil {
		t.Fatalf("count messages: %v", err)
	}
	if err := db.Model(&model.PointRecord{}).Where("user_id = ? AND change_type = ?", ownerID, points.ChangeConsume).Count(&consumes).Error; err != nil {
		t.Fatalf("count consume rows: %v", err)
	}
	if messages != 1 || consumes != 1 {
		t.Fatalf("message/consume rows = %d/%d, want 1/1", messages, consumes)
	}
}

func TestClaimTextRequestInsufficientBalanceRollsBackFence(t *testing.T) {
	db := openPersistTurnTestDB(t)
	if err := db.AutoMigrate(&model.IMConversation{}, &model.User{}, &model.PointRecord{}); err != nil {
		t.Fatalf("migrate billing rows: %v", err)
	}
	ownerID, conversationID := idgen.Next(), idgen.Next()
	if err := db.Create(&model.IMConversation{BaseModel: model.BaseModel{ID: conversationID}, Type: "ai", OwnerID: ownerID}).Error; err != nil {
		t.Fatalf("create conversation: %v", err)
	}
	if err := db.Create(&model.User{ID: ownerID, Username: "text-claim-poor", Points: 4}).Error; err != nil {
		t.Fatalf("create user: %v", err)
	}
	requestID := "chat-request-insufficient"
	msg := &model.IMMessage{
		ConversationID:  conversationID,
		SenderID:        ownerID,
		ContentType:     "text",
		Content:         "too expensive",
		ClientRequestID: textRequestID(requestID),
	}
	_, err := newRepo(db).claimTextRequest(context.Background(), msg, func(tx *gorm.DB) error {
		return points.Consume(tx, ownerID, 5, "must roll back", idgen.Next())
	})
	if !errors.Is(err, points.ErrInsufficient) {
		t.Fatalf("claim error = %v, want points.ErrInsufficient", err)
	}

	var messages int64
	if err := db.Model(&model.IMMessage{}).Where("conversation_id = ?", conversationID).Count(&messages).Error; err != nil {
		t.Fatalf("count messages: %v", err)
	}
	if messages != 0 {
		t.Fatalf("rolled-back debit left %d request fence(s)", messages)
	}
	var user model.User
	if err := db.Select("id", "points").First(&user, "id = ?", ownerID).Error; err != nil {
		t.Fatalf("load user: %v", err)
	}
	if user.Points != 4 {
		t.Fatalf("balance = %d, want unchanged 4", user.Points)
	}
}

func TestExpiredTextLeaseIsRecoveredOnceAcrossInstances(t *testing.T) {
	db := openPersistTurnTestDB(t)
	if err := db.AutoMigrate(&model.IMConversation{}, &model.User{}, &model.PointRecord{}, &model.PointRefundReceipt{}); err != nil {
		t.Fatalf("migrate recovery rows: %v", err)
	}
	ownerID, conversationID, chargeRefID := idgen.Next(), idgen.Next(), idgen.Next()
	if err := db.Create(&model.User{ID: ownerID, Username: "text-recovery", Points: 10}).Error; err != nil {
		t.Fatalf("create user: %v", err)
	}
	if err := points.Consume(db, ownerID, 5, "original chat debit", chargeRefID); err != nil {
		t.Fatalf("seed original debit: %v", err)
	}
	if err := db.Create(&model.IMConversation{
		BaseModel: model.BaseModel{ID: conversationID}, Type: "ai", OwnerID: ownerID,
	}).Error; err != nil {
		t.Fatalf("create conversation: %v", err)
	}
	requestID := "chat-request-expired-recovery"
	expired := time.Now().Add(-time.Minute)
	if err := db.Create(&model.IMMessage{
		ConversationID:     conversationID,
		SenderID:           ownerID,
		ContentType:        "text",
		Content:            "recover me",
		ClientRequestID:    textRequestID(requestID),
		RequestLeaseUntil:  &expired,
		RequestChargeRefID: &chargeRefID,
		RequestChargeCost:  5,
		RequestSnapshot: encodeTextRequestSnapshot(textRequestSnapshot{
			Version: 1,
		}),
	}).Error; err != nil {
		t.Fatalf("create expired request: %v", err)
	}

	services := []*service{
		{repo: newRepo(db), historyLimit: 20, ctxTokenLimit: 32000, live: make(map[liveReplyKey]*liveReply)},
		{repo: newRepo(db), historyLimit: 20, ctxTokenLimit: 32000, live: make(map[liveReplyKey]*liveReply)},
	}
	start := make(chan struct{})
	errs := make(chan error, len(services))
	var generated atomic.Int32
	var wg sync.WaitGroup
	for _, svc := range services {
		svc := svc
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			_, err := svc.streamMessage(context.Background(), conversationID, ownerID, "ignored retry body", nil, "", "", false, requestID, func(string) {
				generated.Add(1)
			})
			errs <- err
		}()
	}
	close(start)
	wg.Wait()
	close(errs)
	for err := range errs {
		if err != nil && !errors.Is(err, errTextTurnInProgress) {
			t.Fatalf("recovery returned unexpected error: %v", err)
		}
	}
	if generated.Load() != 1 {
		t.Fatalf("generation count = %d, want exactly 1", generated.Load())
	}

	var messages, consumes int64
	if err := db.Model(&model.IMMessage{}).Where("conversation_id = ?", conversationID).Count(&messages).Error; err != nil {
		t.Fatalf("count messages: %v", err)
	}
	if err := db.Model(&model.PointRecord{}).Where("user_id = ? AND change_type = ?", ownerID, points.ChangeConsume).Count(&consumes).Error; err != nil {
		t.Fatalf("count consumes: %v", err)
	}
	if messages != 2 || consumes != 1 {
		t.Fatalf("messages/consumes = %d/%d, want 2/1", messages, consumes)
	}
	var user model.User
	if err := db.Select("id", "points").First(&user, "id = ?", ownerID).Error; err != nil {
		t.Fatalf("load user: %v", err)
	}
	var refunds int64
	if err := db.Model(&model.PointRecord{}).
		Where("user_id = ? AND change_type = ? AND ref_id = ?", ownerID, points.ChangeRefund, chargeRefID).
		Count(&refunds).Error; err != nil {
		t.Fatalf("count fallback refunds: %v", err)
	}
	if user.Points != 10 || refunds != 1 {
		t.Fatalf("balance/refunds = %d/%d, want 10/1 (no provider call and no recovery debit)", user.Points, refunds)
	}
}

func TestRecoveryClaimRechecksAssistantAfterStaleUserRead(t *testing.T) {
	db := openPersistTurnTestDB(t)
	ownerID, conversationID := idgen.Next(), idgen.Next()
	requestID := "chat-request-check-complete-claim"
	leaseUntil := time.Now().Add(time.Minute)
	leaseToken := idgen.Next()
	staleUser := &model.IMMessage{
		ConversationID:    conversationID,
		SenderID:          ownerID,
		ContentType:       "text",
		Content:           "stale read",
		ClientRequestID:   textRequestID(requestID),
		RequestLeaseUntil: &leaseUntil,
		RequestLeaseToken: &leaseToken,
	}
	if err := db.Create(staleUser).Error; err != nil {
		t.Fatalf("create user request: %v", err)
	}
	wantAssistant := &model.IMMessage{
		ConversationID:  conversationID,
		SenderID:        assistantSenderID,
		ContentType:     "text",
		Content:         "already completed",
		ClientRequestID: textRequestID(requestID),
	}
	repository := newRepo(db)
	persisted, err := repository.completeTextRequest(staleUser.ID, leaseToken, wantAssistant)
	if err != nil {
		t.Fatalf("complete winner request: %v", err)
	}

	// staleUser represents the retry's earlier user lookup. Completion has now
	// inserted the assistant and cleared the DB lease behind that stale read.
	svc := &service{repo: repository}
	completed, claimed, _, err := svc.claimTextRequestRecovery(staleUser, conversationID, ownerID, requestID)
	if err != nil {
		t.Fatalf("claim recovery: %v", err)
	}
	if claimed {
		t.Fatal("stale retry retained a lease after completion")
	}
	if completed == nil || completed.ID != persisted.ID {
		t.Fatalf("completed = %#v, want assistant %s", completed, persisted.ID.String())
	}
}

func TestExpiredLeaseOwnerCannotReleaseNewOwner(t *testing.T) {
	db := openPersistTurnTestDB(t)
	repository := newRepo(db)
	ownerID, conversationID := idgen.Next(), idgen.Next()
	requestID := "chat-request-lease-cas"
	oldToken, newToken := idgen.Next(), idgen.Next()
	expired := time.Now().Add(-time.Minute)
	message := &model.IMMessage{
		ConversationID:    conversationID,
		SenderID:          ownerID,
		ContentType:       "text",
		Content:           "lease transfer",
		ClientRequestID:   textRequestID(requestID),
		RequestLeaseUntil: &expired,
		RequestLeaseToken: &oldToken,
	}
	if err := db.Create(message).Error; err != nil {
		t.Fatalf("create leased request: %v", err)
	}
	now := time.Now()
	newUntil := now.Add(textTurnLeaseDuration)
	claimed, err := repository.claimExpiredTextRequest(message.ID, conversationID, ownerID, requestID, now, newUntil, newToken)
	if err != nil {
		t.Fatalf("transfer expired lease: %v", err)
	}
	if !claimed {
		t.Fatal("new owner did not claim expired lease")
	}
	if err := repository.releaseTextRequestLease(message.ID, oldToken); err != nil {
		t.Fatalf("old owner release: %v", err)
	}

	var persisted model.IMMessage
	if err := db.First(&persisted, "id = ?", message.ID).Error; err != nil {
		t.Fatalf("load transferred lease: %v", err)
	}
	if persisted.RequestLeaseToken == nil || *persisted.RequestLeaseToken != newToken {
		t.Fatalf("old owner cleared/replaced new token: %#v", persisted.RequestLeaseToken)
	}
	if persisted.RequestLeaseUntil == nil || !persisted.RequestLeaseUntil.After(now) {
		t.Fatalf("old owner cleared new lease deadline: %#v", persisted.RequestLeaseUntil)
	}

	if err := repository.releaseTextRequestLease(message.ID, newToken); err != nil {
		t.Fatalf("new owner release: %v", err)
	}
	persisted = model.IMMessage{}
	if err := db.First(&persisted, "id = ?", message.ID).Error; err != nil {
		t.Fatalf("reload released lease: %v", err)
	}
	if persisted.RequestLeaseToken != nil || persisted.RequestLeaseUntil != nil {
		t.Fatalf("current owner failed to release lease: token=%v until=%v", persisted.RequestLeaseToken, persisted.RequestLeaseUntil)
	}
}

func TestExpiredLeaseOwnerCannotCompleteOrFinalize(t *testing.T) {
	db := openPersistTurnTestDB(t)
	repository := newRepo(db)
	ownerID, conversationID := idgen.Next(), idgen.Next()
	requestID := "chat-request-stale-completion"
	oldToken, newToken := idgen.Next(), idgen.Next()
	expired := time.Now().Add(-time.Minute)
	message := &model.IMMessage{
		ConversationID:    conversationID,
		SenderID:          ownerID,
		ContentType:       "text",
		Content:           "lease transfer",
		ClientRequestID:   textRequestID(requestID),
		RequestLeaseUntil: &expired,
		RequestLeaseToken: &oldToken,
	}
	if err := db.Create(message).Error; err != nil {
		t.Fatalf("create leased request: %v", err)
	}
	now := time.Now()
	claimed, err := repository.claimExpiredTextRequest(
		message.ID, conversationID, ownerID, requestID, now,
		now.Add(textTurnLeaseDuration), newToken,
	)
	if err != nil || !claimed {
		t.Fatalf("transfer expired lease: claimed=%v err=%v", claimed, err)
	}

	var finalized atomic.Int32
	staleAssistant := &model.IMMessage{
		ConversationID:  conversationID,
		SenderID:        assistantSenderID,
		ContentType:     "text",
		Content:         "stale answer",
		ClientRequestID: textRequestID(requestID),
	}
	persisted, err := repository.completeTextRequestWithFinalize(message.ID, oldToken, staleAssistant, func(*gorm.DB) error {
		finalized.Add(1)
		return nil
	})
	if persisted != nil || !errors.Is(err, errTextTurnLeaseLost) {
		t.Fatalf("stale completion = (%#v, %v), want lease-lost", persisted, err)
	}
	if finalized.Load() != 0 {
		t.Fatalf("stale completion ran billing finalizer %d time(s)", finalized.Load())
	}
	var assistantCount int64
	if err := db.Model(&model.IMMessage{}).
		Where("conversation_id = ? AND sender_id = ?", conversationID, assistantSenderID).
		Count(&assistantCount).Error; err != nil {
		t.Fatalf("count assistants: %v", err)
	}
	if assistantCount != 0 {
		t.Fatalf("stale completion persisted %d assistant row(s)", assistantCount)
	}

	currentAssistant := &model.IMMessage{
		ConversationID:  conversationID,
		SenderID:        assistantSenderID,
		ContentType:     "text",
		Content:         "current answer",
		ClientRequestID: textRequestID(requestID),
	}
	persisted, err = repository.completeTextRequestWithFinalize(message.ID, newToken, currentAssistant, func(*gorm.DB) error {
		finalized.Add(1)
		return nil
	})
	if err != nil || persisted == nil || persisted.Content != "current answer" {
		t.Fatalf("current completion = (%#v, %v)", persisted, err)
	}
	if finalized.Load() != 1 {
		t.Fatalf("current completion finalized %d time(s), want 1", finalized.Load())
	}
}

func TestTextCompletionRefundIsAtomicWithAssistant(t *testing.T) {
	db := openPersistTurnTestDB(t)
	if err := db.AutoMigrate(&model.User{}, &model.PointRecord{}, &model.PointRefundReceipt{}); err != nil {
		t.Fatalf("migrate billing rows: %v", err)
	}
	repository := newRepo(db)
	ownerID, conversationID := idgen.Next(), idgen.Next()
	requestID := "chat-request-atomic-refund"
	leaseToken, chargeRefID := idgen.Next(), idgen.Next()
	leaseUntil := time.Now().Add(time.Minute)
	if err := db.Create(&model.User{ID: ownerID, Username: "text-refund-owner", Points: 10}).Error; err != nil {
		t.Fatalf("create user: %v", err)
	}
	if err := points.Consume(db, ownerID, 5, "original chat debit", chargeRefID); err != nil {
		t.Fatalf("seed debit: %v", err)
	}
	message := &model.IMMessage{
		ConversationID:     conversationID,
		SenderID:           ownerID,
		ContentType:        "text",
		Content:            "fallback please",
		ClientRequestID:    textRequestID(requestID),
		RequestLeaseUntil:  &leaseUntil,
		RequestLeaseToken:  &leaseToken,
		RequestChargeRefID: &chargeRefID,
		RequestChargeCost:  5,
	}
	if err := db.Create(message).Error; err != nil {
		t.Fatalf("create request: %v", err)
	}
	charge := textChargeFromMessage(message, ownerID)
	assistant := &model.IMMessage{
		ConversationID:  conversationID,
		SenderID:        assistantSenderID,
		ContentType:     "text",
		Content:         "fallback",
		ClientRequestID: textRequestID(requestID),
	}
	persisted, err := repository.completeTextRequestWithFinalize(message.ID, leaseToken, assistant, func(tx *gorm.DB) error {
		return refundTextCallDB(tx, charge)
	})
	if err != nil || persisted == nil {
		t.Fatalf("complete fallback: persisted=%#v err=%v", persisted, err)
	}
	var user model.User
	if err := db.Select("id", "points").First(&user, "id = ?", ownerID).Error; err != nil {
		t.Fatalf("load user: %v", err)
	}
	if user.Points != 10 {
		t.Fatalf("balance = %d, want original 10 after atomic refund", user.Points)
	}
	var refundCount int64
	if err := db.Model(&model.PointRecord{}).
		Where("user_id = ? AND change_type = ? AND ref_id = ?", ownerID, points.ChangeRefund, chargeRefID).
		Count(&refundCount).Error; err != nil {
		t.Fatalf("count refunds: %v", err)
	}
	if refundCount != 1 {
		t.Fatalf("refund rows = %d, want 1", refundCount)
	}
}

func TestTextCompletionFinalizerFailureRollsBackAssistantAndLease(t *testing.T) {
	db := openPersistTurnTestDB(t)
	repository := newRepo(db)
	ownerID, conversationID := idgen.Next(), idgen.Next()
	requestID := "chat-request-finalizer-rollback"
	leaseToken := idgen.Next()
	leaseUntil := time.Now().Add(time.Minute)
	message := &model.IMMessage{
		ConversationID:    conversationID,
		SenderID:          ownerID,
		ContentType:       "text",
		Content:           "must remain recoverable",
		ClientRequestID:   textRequestID(requestID),
		RequestLeaseUntil: &leaseUntil,
		RequestLeaseToken: &leaseToken,
	}
	if err := db.Create(message).Error; err != nil {
		t.Fatalf("create request: %v", err)
	}
	wantErr := errors.New("forced finalizer failure")
	assistant := &model.IMMessage{
		ConversationID:  conversationID,
		SenderID:        assistantSenderID,
		ContentType:     "text",
		Content:         "must roll back",
		ClientRequestID: textRequestID(requestID),
	}
	if persisted, err := repository.completeTextRequestWithFinalize(message.ID, leaseToken, assistant, func(*gorm.DB) error {
		return wantErr
	}); persisted != nil || !errors.Is(err, wantErr) {
		t.Fatalf("completion = (%#v, %v), want finalizer failure", persisted, err)
	}
	var assistantCount int64
	if err := db.Model(&model.IMMessage{}).
		Where("conversation_id = ? AND sender_id = ?", conversationID, assistantSenderID).
		Count(&assistantCount).Error; err != nil {
		t.Fatalf("count assistants: %v", err)
	}
	if assistantCount != 0 {
		t.Fatalf("failed finalizer left %d assistant row(s)", assistantCount)
	}
	var persistedUser model.IMMessage
	if err := db.First(&persistedUser, "id = ?", message.ID).Error; err != nil {
		t.Fatalf("reload request: %v", err)
	}
	if persistedUser.RequestLeaseToken == nil || *persistedUser.RequestLeaseToken != leaseToken {
		t.Fatalf("failed finalizer consumed lease: %#v", persistedUser.RequestLeaseToken)
	}
}

func TestDeleteConversationRejectsUnfinishedIdempotentTurn(t *testing.T) {
	db := openPersistTurnTestDB(t)
	if err := db.AutoMigrate(&model.IMConversation{}, &model.IMConversationMember{}); err != nil {
		t.Fatalf("migrate conversation rows: %v", err)
	}
	repository := newRepo(db)
	ownerID, conversationID := idgen.Next(), idgen.Next()
	requestID := "chat-request-delete-guard"
	if err := db.Create(&model.IMConversation{
		BaseModel: model.BaseModel{ID: conversationID}, Type: "ai", OwnerID: ownerID,
	}).Error; err != nil {
		t.Fatalf("create conversation: %v", err)
	}
	if err := db.Create(&model.IMMessage{
		ConversationID:  conversationID,
		SenderID:        ownerID,
		ContentType:     "text",
		Content:         "still generating",
		ClientRequestID: textRequestID(requestID),
	}).Error; err != nil {
		t.Fatalf("create unfinished request: %v", err)
	}
	if err := repository.deleteConversation(conversationID); !errors.Is(err, errConversationBusy) {
		t.Fatalf("delete unfinished conversation: err=%v, want busy", err)
	}
	if _, err := repository.findConversation(conversationID); err != nil {
		t.Fatalf("busy delete removed conversation: %v", err)
	}

	if err := db.Create(&model.IMMessage{
		ConversationID:  conversationID,
		SenderID:        assistantSenderID,
		ContentType:     "text",
		Content:         "finished",
		ClientRequestID: textRequestID(requestID),
	}).Error; err != nil {
		t.Fatalf("create completed assistant: %v", err)
	}
	if err := repository.deleteConversation(conversationID); err != nil {
		t.Fatalf("delete completed conversation: %v", err)
	}
	if _, err := repository.findConversation(conversationID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("deleted conversation lookup: err=%v, want not found", err)
	}
}

func TestPaidFallbackBeforeProviderRequestsAtomicRefund(t *testing.T) {
	svc := &service{}
	charge := &textCharge{cost: 5, ownerID: idgen.Next(), refID: idgen.Next()}
	reply, refundRequired := svc.streamReply(
		context.Background(),
		&model.IMConversation{BaseModel: model.BaseModel{ID: idgen.Next()}},
		charge.ownerID,
		idgen.Next(),
		"hello",
		"",
		nil,
		nil,
		"missing-model",
		"",
		false,
		nil,
		charge,
	)
	if strings.TrimSpace(reply) == "" {
		t.Fatal("fallback reply is empty")
	}
	if !refundRequired {
		t.Fatal("paid request that never reached a provider did not request refund")
	}
}

func TestAssistantPersistenceFailureDoesNotReturnPhantomDone(t *testing.T) {
	db := openPersistTurnTestDB(t)
	if err := db.AutoMigrate(&model.IMConversation{}); err != nil {
		t.Fatalf("migrate conversation: %v", err)
	}
	ownerID, conversationID := idgen.Next(), idgen.Next()
	if err := db.Create(&model.IMConversation{
		BaseModel: model.BaseModel{ID: conversationID}, Type: "ai", OwnerID: ownerID,
	}).Error; err != nil {
		t.Fatalf("create conversation: %v", err)
	}

	const callbackName = "test:fail_text_assistant_create"
	if err := db.Callback().Create().Before("gorm:create").Register(callbackName, func(tx *gorm.DB) {
		message, ok := tx.Statement.Dest.(*model.IMMessage)
		if ok && message.SenderID == assistantSenderID && message.ClientRequestID != nil {
			tx.AddError(errors.New("forced assistant persistence failure"))
		}
	}); err != nil {
		t.Fatalf("register failure callback: %v", err)
	}
	t.Cleanup(func() { _ = db.Callback().Create().Remove(callbackName) })

	svc := &service{repo: newRepo(db), historyLimit: 20, ctxTokenLimit: 32000, live: make(map[liveReplyKey]*liveReply)}
	requestID := "chat-request-no-phantom"
	vo, err := svc.streamMessage(context.Background(), conversationID, ownerID, "hello", nil, "", "", false, requestID, nil)
	if vo != nil {
		t.Fatalf("persistence failure returned phantom message %s", vo.ID.String())
	}
	if !errors.Is(err, errTextTurnInProgress) {
		t.Fatalf("persistence error = %v, want retryable pending", err)
	}
	if retryAfter := textTurnRetryAfter(err); retryAfter != time.Second {
		t.Fatalf("retryAfter = %s, want 1s after released lease", retryAfter)
	}

	var userRow model.IMMessage
	if err := db.Where("conversation_id = ? AND sender_id = ?", conversationID, ownerID).First(&userRow).Error; err != nil {
		t.Fatalf("load durable user request: %v", err)
	}
	if userRow.RequestLeaseUntil != nil {
		t.Fatalf("failed assistant left lease until %v; want released", *userRow.RequestLeaseUntil)
	}
	var assistantCount int64
	if err := db.Model(&model.IMMessage{}).
		Where("conversation_id = ? AND sender_id = ?", conversationID, assistantSenderID).
		Count(&assistantCount).Error; err != nil {
		t.Fatalf("count assistants: %v", err)
	}
	if assistantCount != 0 {
		t.Fatalf("persistence failure left %d assistant row(s)", assistantCount)
	}

	if err := db.Callback().Create().Remove(callbackName); err != nil {
		t.Fatalf("remove failure callback: %v", err)
	}
	recovered, err := svc.streamMessage(context.Background(), conversationID, ownerID, "hello", nil, "", "", false, requestID, nil)
	if err != nil {
		t.Fatalf("retry after released lease: %v", err)
	}
	if recovered == nil || recovered.ID == 0 {
		t.Fatal("retry did not return a persisted assistant")
	}
}

func TestDifferentTextRequestIsFencedBeforeInsertAndDebit(t *testing.T) {
	db := openPersistTurnTestDB(t)
	if err := db.AutoMigrate(&model.IMConversation{}, &model.User{}, &model.PointRecord{}); err != nil {
		t.Fatalf("migrate conversation billing rows: %v", err)
	}
	ownerID, conversationID := idgen.Next(), idgen.Next()
	if err := db.Create(&model.IMConversation{
		BaseModel: model.BaseModel{ID: conversationID}, Type: "ai", OwnerID: ownerID,
	}).Error; err != nil {
		t.Fatalf("create conversation: %v", err)
	}
	if err := db.Create(&model.User{ID: ownerID, Username: "conversation-fence", Points: 10}).Error; err != nil {
		t.Fatalf("create owner: %v", err)
	}

	leaseUntil := time.Now().Add(time.Minute)
	leaseToken := idgen.Next()
	first := &model.IMMessage{
		ConversationID:    conversationID,
		SenderID:          ownerID,
		ContentType:       "text",
		Content:           "first request",
		ClientRequestID:   textRequestID("chat-conversation-first"),
		RequestLeaseUntil: &leaseUntil,
		RequestLeaseToken: &leaseToken,
	}
	firstClaimed, err := newRepo(db).claimTextRequest(context.Background(), first, func(tx *gorm.DB) error {
		return points.Consume(tx, ownerID, 4, "first conversation request", idgen.Next())
	})
	if err != nil || !firstClaimed {
		t.Fatalf("claim first request = %v/%v, want true/nil", firstClaimed, err)
	}

	second := &model.IMMessage{
		ConversationID:  conversationID,
		SenderID:        ownerID,
		ContentType:     "text",
		Content:         "second request must wait",
		ClientRequestID: textRequestID("chat-conversation-second"),
	}
	secondClaimed, err := newRepo(db).claimTextRequest(context.Background(), second, func(tx *gorm.DB) error {
		return points.Consume(tx, ownerID, 4, "must not debit", idgen.Next())
	})
	if secondClaimed || !errors.Is(err, errTextTurnInProgress) {
		t.Fatalf("claim second request = %v/%v, want false/TURN_IN_PROGRESS", secondClaimed, err)
	}

	var messageCount, consumeCount int64
	if err := db.Model(&model.IMMessage{}).Where("conversation_id = ?", conversationID).Count(&messageCount).Error; err != nil {
		t.Fatalf("count messages: %v", err)
	}
	if err := db.Model(&model.PointRecord{}).
		Where("user_id = ? AND change_type = ?", ownerID, points.ChangeConsume).
		Count(&consumeCount).Error; err != nil {
		t.Fatalf("count debits: %v", err)
	}
	var owner model.User
	if err := db.Select("id", "points").First(&owner, "id = ?", ownerID).Error; err != nil {
		t.Fatalf("load owner: %v", err)
	}
	if messageCount != 1 || consumeCount != 1 || owner.Points != 6 {
		t.Fatalf("messages/debits/balance = %d/%d/%d, want 1/1/6", messageCount, consumeCount, owner.Points)
	}
}

func TestListMessagesTerminalizesExpiredTextRequestAndRefundsOnce(t *testing.T) {
	db := openPersistTurnTestDB(t)
	if err := db.AutoMigrate(
		&model.IMConversation{},
		&model.User{},
		&model.PointRecord{},
		&model.PointRefundReceipt{},
	); err != nil {
		t.Fatalf("migrate recovery billing rows: %v", err)
	}
	ownerID, conversationID, chargeRefID := idgen.Next(), idgen.Next(), idgen.Next()
	if err := db.Create(&model.User{ID: ownerID, Username: "expired-text-refund", Points: 10}).Error; err != nil {
		t.Fatalf("create owner: %v", err)
	}
	if err := points.Consume(db, ownerID, 5, "expired chat request", chargeRefID); err != nil {
		t.Fatalf("seed request debit: %v", err)
	}
	if err := db.Create(&model.IMConversation{
		BaseModel: model.BaseModel{ID: conversationID}, Type: "ai", OwnerID: ownerID,
	}).Error; err != nil {
		t.Fatalf("create conversation: %v", err)
	}
	requestID := "chat-expired-without-browser-journal"
	expiredAt := time.Now().Add(-time.Minute)
	leaseToken := idgen.Next()
	if err := db.Create(&model.IMMessage{
		ConversationID:     conversationID,
		SenderID:           ownerID,
		ContentType:        "text",
		Content:            "request accepted before crash",
		ClientRequestID:    textRequestID(requestID),
		RequestLeaseUntil:  &expiredAt,
		RequestLeaseToken:  &leaseToken,
		RequestChargeRefID: &chargeRefID,
		RequestChargeCost:  5,
	}).Error; err != nil {
		t.Fatalf("create expired request: %v", err)
	}

	svc := &service{repo: newRepo(db), historyLimit: 20, ctxTokenLimit: 32000, live: make(map[liveReplyKey]*liveReply)}
	query := &ListQuery{PageNum: 1, PageSize: 100}
	query.normalize()
	for pass := 0; pass < 2; pass++ {
		messages, total, err := svc.listMessages(conversationID, ownerID, query)
		if err != nil {
			t.Fatalf("list messages pass %d: %v", pass, err)
		}
		if total != 2 || len(messages) != 2 {
			t.Fatalf("pass %d total/messages = %d/%d, want 2/2", pass, total, len(messages))
		}
		terminal := messages[1]
		if terminal.Role != "ai" || terminal.ClientRequestID == nil || *terminal.ClientRequestID != requestID || terminal.Content != interruptedTextReply {
			t.Fatalf("pass %d terminal assistant = %#v", pass, terminal)
		}
	}

	var owner model.User
	if err := db.Select("id", "points").First(&owner, "id = ?", ownerID).Error; err != nil {
		t.Fatalf("load refunded owner: %v", err)
	}
	var refundCount int64
	if err := db.Model(&model.PointRecord{}).
		Where("user_id = ? AND change_type = ? AND ref_id = ?", ownerID, points.ChangeRefund, chargeRefID).
		Count(&refundCount).Error; err != nil {
		t.Fatalf("count refunds: %v", err)
	}
	if owner.Points != 10 || refundCount != 1 {
		t.Fatalf("balance/refunds = %d/%d, want 10/1", owner.Points, refundCount)
	}
	if err := svc.deleteConversation(conversationID, ownerID); err != nil {
		t.Fatalf("expired request still blocked deletion: %v", err)
	}
}

func TestListMessagesDoesNotRefundLiveTextRequest(t *testing.T) {
	db := openPersistTurnTestDB(t)
	if err := db.AutoMigrate(
		&model.IMConversation{},
		&model.User{},
		&model.PointRecord{},
		&model.PointRefundReceipt{},
	); err != nil {
		t.Fatalf("migrate live-request billing rows: %v", err)
	}
	ownerID, conversationID, chargeRefID := idgen.Next(), idgen.Next(), idgen.Next()
	if err := db.Create(&model.User{ID: ownerID, Username: "live-text-no-refund", Points: 10}).Error; err != nil {
		t.Fatalf("create owner: %v", err)
	}
	if err := points.Consume(db, ownerID, 5, "live chat request", chargeRefID); err != nil {
		t.Fatalf("seed request debit: %v", err)
	}
	if err := db.Create(&model.IMConversation{
		BaseModel: model.BaseModel{ID: conversationID}, Type: "ai", OwnerID: ownerID,
	}).Error; err != nil {
		t.Fatalf("create conversation: %v", err)
	}
	requestID := "chat-live-must-not-refund"
	leaseUntil := time.Now().Add(time.Minute)
	leaseToken := idgen.Next()
	if err := db.Create(&model.IMMessage{
		ConversationID:     conversationID,
		SenderID:           ownerID,
		ContentType:        "text",
		Content:            "provider is still working",
		ClientRequestID:    textRequestID(requestID),
		RequestLeaseUntil:  &leaseUntil,
		RequestLeaseToken:  &leaseToken,
		RequestChargeRefID: &chargeRefID,
		RequestChargeCost:  5,
	}).Error; err != nil {
		t.Fatalf("create live request: %v", err)
	}

	svc := &service{repo: newRepo(db), historyLimit: 20, ctxTokenLimit: 32000, live: make(map[liveReplyKey]*liveReply)}
	query := &ListQuery{PageNum: 1, PageSize: 100}
	query.normalize()
	messages, total, err := svc.listMessages(conversationID, ownerID, query)
	if err != nil {
		t.Fatalf("list live request: %v", err)
	}
	if total != 1 || len(messages) != 1 {
		t.Fatalf("total/messages = %d/%d, want the lone live user row", total, len(messages))
	}
	var owner model.User
	if err := db.Select("id", "points").First(&owner, "id = ?", ownerID).Error; err != nil {
		t.Fatalf("load owner: %v", err)
	}
	var refundCount int64
	if err := db.Model(&model.PointRecord{}).
		Where("user_id = ? AND change_type = ? AND ref_id = ?", ownerID, points.ChangeRefund, chargeRefID).
		Count(&refundCount).Error; err != nil {
		t.Fatalf("count refunds: %v", err)
	}
	if owner.Points != 5 || refundCount != 0 {
		t.Fatalf("balance/refunds = %d/%d, want 5/0 while lease is live", owner.Points, refundCount)
	}
	if err := svc.deleteConversation(conversationID, ownerID); !errors.Is(err, errConversationBusy) {
		t.Fatalf("delete live conversation = %v, want errConversationBusy", err)
	}
}

func TestLiveAttachIsScopedByClientRequestID(t *testing.T) {
	db := openPersistTurnTestDB(t)
	if err := db.AutoMigrate(&model.IMConversation{}); err != nil {
		t.Fatalf("migrate conversation: %v", err)
	}
	ownerID, conversationID := idgen.Next(), idgen.Next()
	if err := db.Create(&model.IMConversation{
		BaseModel: model.BaseModel{ID: conversationID}, Type: "ai", OwnerID: ownerID,
	}).Error; err != nil {
		t.Fatalf("create conversation: %v", err)
	}
	svc := &service{repo: newRepo(db), live: make(map[liveReplyKey]*liveReply)}
	first := svc.liveStart(conversationID, "request-a")
	second := svc.liveStart(conversationID, "request-b")

	gotFirst, err := svc.attachLive(conversationID, ownerID, "request-a")
	if err != nil || gotFirst != first {
		t.Fatalf("attach request-a = %p/%v, want %p/nil", gotFirst, err, first)
	}
	gotSecond, err := svc.attachLive(conversationID, ownerID, "request-b")
	if err != nil || gotSecond != second {
		t.Fatalf("attach request-b = %p/%v, want %p/nil", gotSecond, err, second)
	}
	ambiguous, err := svc.attachLive(conversationID, ownerID, "")
	if err != nil || ambiguous != nil {
		t.Fatalf("legacy ambiguous attach = %p/%v, want nil/nil", ambiguous, err)
	}
	missing, err := svc.attachLive(conversationID, ownerID, "request-c")
	if err != nil || missing != nil {
		t.Fatalf("wrong request attach = %p/%v, want nil/nil", missing, err)
	}

	svc.liveEnd(conversationID, "request-a", first)
	remaining, err := svc.attachLive(conversationID, ownerID, "request-b")
	if err != nil || remaining != second {
		t.Fatalf("ending request-a removed request-b: %p/%v", remaining, err)
	}
	svc.liveEnd(conversationID, "request-b", second)
}

func TestRecentMessagesAreBoundedByCurrentUserMessage(t *testing.T) {
	db := openPersistTurnTestDB(t)
	if err := db.AutoMigrate(&model.SkillRunArtifact{}); err != nil {
		t.Fatalf("migrate context dependency: %v", err)
	}
	conversationID, ownerID := idgen.Next(), idgen.Next()
	rows := []*model.IMMessage{
		{ConversationID: conversationID, SenderID: ownerID, ContentType: "text", Content: "earlier user"},
		{ConversationID: conversationID, SenderID: assistantSenderID, ContentType: "text", Content: "earlier assistant"},
		{ConversationID: conversationID, SenderID: ownerID, ContentType: "text", Content: "current request"},
		{ConversationID: conversationID, SenderID: ownerID, ContentType: "text", Content: "later write must be excluded"},
	}
	for i, row := range rows {
		if err := db.Create(row).Error; err != nil {
			t.Fatalf("create message %d: %v", i, err)
		}
	}

	got, err := newRepo(db).recentMessages(conversationID, 0, rows[2].ID, 20)
	if err != nil {
		t.Fatalf("load bounded context: %v", err)
	}
	if len(got) != 3 || got[len(got)-1].ID != rows[2].ID {
		t.Fatalf("bounded context ids = %#v, want exactly through current message %s", got, rows[2].ID.String())
	}
	for _, message := range got {
		if message.ID == rows[3].ID {
			t.Fatal("later conversation write leaked into the current model request")
		}
	}
}
