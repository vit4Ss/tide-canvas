package chat

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/idgen"
)

// repo.go is the chat domain's persistence layer over *gorm.DB.

// ErrNotFound is returned when a conversation lookup yields no row.
var ErrNotFound = errors.New("chat: not found")

type repo struct {
	db *gorm.DB
}

func newRepo(db *gorm.DB) *repo { return &repo{db: db} }

// textModelKey returns the upstream model id (model_key) to use for the chat
// assistant: the listed text model flagged as the AI-optimization primary if one
// exists, otherwise any listed text model. "" when none is configured.
func (r *repo) textModelKey() string {
	const base = "type = ? AND status = 1 AND model_key <> ''"
	var m model.MarketModel
	if err := r.db.Where(base, "text").
		Where("config LIKE ?", `%"aiOptimizePrimary":true%`).
		Order("update_time DESC").First(&m).Error; err == nil && m.ModelKey != "" {
		return m.ModelKey
	}
	if err := r.db.Where(base, "text").Order("update_time DESC").First(&m).Error; err == nil {
		return m.ModelKey
	}
	return ""
}

// resolveTextModelKey honors the composer's model pick when it names a listed
// enabled text model (so a client can't route chat to arbitrary upstream
// models), falling back to textModelKey() otherwise.
func (r *repo) resolveTextModelKey(requested string) string {
	if m := r.resolveTextModel(requested); m != nil {
		return m.ModelKey
	}
	return ""
}

// resolveTextModel 同 resolveTextModelKey,但返回整行——计费需要模型的
// 目录价(Price)与名称。
func (r *repo) resolveTextModel(requested string) *model.MarketModel {
	if requested = strings.TrimSpace(requested); requested != "" {
		var m model.MarketModel
		if err := r.db.Where("type = ? AND status = 1 AND model_key = ?", "text", requested).
			First(&m).Error; err == nil && m.ModelKey != "" {
			return &m
		}
	}
	const base = "type = ? AND status = 1 AND model_key <> ''"
	var m model.MarketModel
	if err := r.db.Where(base, "text").
		Where("config LIKE ?", `%"aiOptimizePrimary":true%`).
		Order("update_time DESC").First(&m).Error; err == nil && m.ModelKey != "" {
		return &m
	}
	if err := r.db.Where(base, "text").Order("update_time DESC").First(&m).Error; err == nil {
		return &m
	}
	return nil
}

// listConversations returns a page of the owner's conversations plus the total
// count, ordered by the most recent activity first (last_message_at desc, then
// create_time desc as a tie-breaker for never-used conversations).
func (r *repo) listConversations(ownerID idgen.ID, q *ListQuery) ([]model.IMConversation, int64, error) {
	tx := r.db.Model(&model.IMConversation{}).Where("owner_id = ?", ownerID)

	var total int64
	if err := tx.Count(&total).Error; err != nil {
		return nil, 0, err
	}

	var rows []model.IMConversation
	if err := tx.
		Order("last_message_at DESC").
		Order("create_time DESC").
		Limit(q.PageSize).Offset(q.offset()).
		Find(&rows).Error; err != nil {
		return nil, 0, err
	}
	return rows, total, nil
}

// findConversation loads a conversation by primary key (any owner). Ownership is
// enforced in the service.
func (r *repo) findConversation(id idgen.ID) (*model.IMConversation, error) {
	var c model.IMConversation
	err := r.db.Where("id = ?", id).First(&c).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	return &c, nil
}

// createConversation inserts a new conversation.
func (r *repo) createConversation(c *model.IMConversation) error {
	return r.db.Create(c).Error
}

// updateConversationTitle renames a conversation.
func (r *repo) updateConversationTitle(id idgen.ID, title string) error {
	return r.db.Model(&model.IMConversation{}).Where("id = ?", id).Update("title", title).Error
}

// deleteConversation removes a conversation along with its messages and member
// rows in one transaction.
func (r *repo) deleteConversation(id idgen.ID) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		// Serialize deletion with the first durable request claim. Once a user
		// request exists, keep the conversation until its matching assistant is
		// durable; otherwise deleting the recovery fence would strand its debit.
		var conversation model.IMConversation
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Select("id", "owner_id").First(&conversation, "id = ?", id).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return ErrNotFound
			}
			return err
		}
		// A crashed worker must not make a conversation undeletable forever.
		// Expired requests are terminalized and refunded under this same row lock;
		// genuinely live requests still keep deletion fenced.
		if _, _, err := reconcileTextRequestsDB(tx, id, conversation.OwnerID, "", time.Now()); err != nil {
			return err
		}
		completedRequests := tx.Model(&model.IMMessage{}).
			Select("client_request_id").
			Where("conversation_id = ? AND sender_id = ? AND client_request_id IS NOT NULL", id, assistantSenderID)
		var unfinished int64
		if err := tx.Model(&model.IMMessage{}).
			Where("conversation_id = ? AND sender_id <> ? AND client_request_id IS NOT NULL", id, assistantSenderID).
			Where("client_request_id NOT IN (?)", completedRequests).
			Count(&unfinished).Error; err != nil {
			return err
		}
		if unfinished > 0 {
			return errConversationBusy
		}
		if err := tx.Where("conversation_id = ?", id).Delete(&model.IMMessage{}).Error; err != nil {
			return err
		}
		if err := tx.Where("conversation_id = ?", id).Delete(&model.IMConversationMember{}).Error; err != nil {
			return err
		}
		return tx.Delete(&model.IMConversation{}, "id = ?", id).Error
	})
}

// createMessageMember registers a user as the owner-member (role 2 = 群主) of a
// conversation. The (conversation_id, user_id) pair is unique, so a duplicate is
// tolerated as a no-op.
func (r *repo) createMessageMember(conversationID, userID idgen.ID) error {
	m := &model.IMConversationMember{
		ConversationID: conversationID,
		UserID:         userID,
		Role:           2,
	}
	return r.db.Where(model.IMConversationMember{
		ConversationID: conversationID,
		UserID:         userID,
	}).FirstOrCreate(m).Error
}

// listMessages returns a page of a conversation's messages plus the total count,
// oldest first so the chat transcript renders top-to-bottom.
func (r *repo) listMessages(conversationID idgen.ID, q *ListQuery) ([]model.IMMessage, int64, error) {
	tx := r.db.Model(&model.IMMessage{}).Where("conversation_id = ?", conversationID)

	var total int64
	if err := tx.Count(&total).Error; err != nil {
		return nil, 0, err
	}

	var rows []model.IMMessage
	if err := tx.
		Order("create_time ASC").
		Order("id ASC").
		Limit(q.PageSize).Offset(q.offset()).
		Find(&rows).Error; err != nil {
		return nil, 0, err
	}
	return rows, total, nil
}

// createMessage inserts a single message.
func (r *repo) createMessage(m *model.IMMessage) error {
	return r.db.Create(m).Error
}

// messageByClientRequest locates one side of an idempotent streamed text turn.
// senderID distinguishes the owner's user row from the assistant row; the same
// nullable request id is deliberately stored on both.
func (r *repo) messageByClientRequest(conversationID, senderID idgen.ID, clientRequestID string) (*model.IMMessage, error) {
	return messageByClientRequestDB(r.db, conversationID, senderID, clientRequestID)
}

func messageByClientRequestDB(db *gorm.DB, conversationID, senderID idgen.ID, clientRequestID string) (*model.IMMessage, error) {
	var message model.IMMessage
	err := db.Where(
		"conversation_id = ? AND sender_id = ? AND client_request_id = ?",
		conversationID,
		senderID,
		clientRequestID,
	).First(&message).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &message, nil
}

// claimTextRequest inserts the durable user-side request fence and runs
// onClaim (the points debit) in the same transaction. The preassigned message
// id identifies which contender won without relying on driver-specific
// RowsAffected behavior for ON CONFLICT DO NOTHING.
func (r *repo) claimTextRequest(ctx context.Context, userMsg *model.IMMessage, onClaim func(*gorm.DB) error) (bool, error) {
	if userMsg == nil || userMsg.ClientRequestID == nil || strings.TrimSpace(*userMsg.ClientRequestID) == "" {
		return false, errors.New("chat: idempotent text request is missing its key")
	}
	if userMsg.ID == 0 {
		userMsg.ID = idgen.Next()
	}
	requestID := strings.TrimSpace(*userMsg.ClientRequestID)
	claimed := false
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		// Deletion takes the same conversation-row lock before checking pending
		// requests. If deletion won the race, fail before inserting or charging;
		// if this claim won, deletion will observe the unfinished durable fence.
		var conversation model.IMConversation
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Select("id").First(&conversation, "id = ?", userMsg.ConversationID).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return ErrNotFound
			}
			return err
		}
		// One conversation may have only one unfinished idempotent text turn.
		// The conversation-row lock makes this fence database-global across app
		// instances. Crucially, the losing request is rejected before its user row
		// or debit exists. A same-key contender is excluded here and falls through
		// to the request-id unique index below.
		busy, retryAfter, err := reconcileTextRequestsDB(
			tx,
			userMsg.ConversationID,
			userMsg.SenderID,
			requestID,
			time.Now(),
		)
		if err != nil {
			return err
		}
		if busy {
			return pendingTextTurn(retryAfter, errConversationBusy)
		}
		if err := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(userMsg).Error; err != nil {
			return err
		}
		persisted, err := messageByClientRequestDB(tx, userMsg.ConversationID, userMsg.SenderID, requestID)
		if err != nil {
			return err
		}
		if persisted == nil {
			return errors.New("chat: request fence insert returned no row")
		}
		if persisted.ID != userMsg.ID {
			*userMsg = *persisted
			return nil
		}
		claimed = true
		if onClaim != nil {
			return onClaim(tx)
		}
		return nil
	})
	if err != nil {
		return false, err
	}
	return claimed, nil
}

// reconcileExpiredTextRequests terminalizes expired text requests for one
// conversation. It is intentionally lazy as well as claim-time: opening the
// conversation is sufficient to refund a request left behind by a crashed
// process even when the browser's local retry journal no longer exists.
func (r *repo) reconcileExpiredTextRequests(conversationID, ownerID idgen.ID, now time.Time) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		var conversation model.IMConversation
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Select("id").
			Where("id = ? AND owner_id = ?", conversationID, ownerID).
			First(&conversation).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return ErrNotFound
			}
			return err
		}
		_, _, err := reconcileTextRequestsDB(tx, conversationID, ownerID, "", now)
		return err
	})
}

// reconcileTextRequestsDB must run while the caller owns the conversation row
// lock. It settles every expired unfinished request and reports whether another
// request still has a live lease. excludeRequestID lets a same-key retry reach
// the normal idempotency path instead of treating itself as conversation-busy.
func reconcileTextRequestsDB(tx *gorm.DB, conversationID, ownerID idgen.ID, excludeRequestID string, now time.Time) (bool, time.Duration, error) {
	var pending []model.IMMessage
	if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
		Where("conversation_id = ? AND sender_id = ? AND client_request_id IS NOT NULL AND client_request_id <> ''", conversationID, ownerID).
		Where(`NOT EXISTS (
			SELECT 1 FROM im_message AS completed
			WHERE completed.deleted IS NULL
			  AND completed.conversation_id = im_message.conversation_id
			  AND completed.sender_id = ?
			  AND completed.client_request_id = im_message.client_request_id
		)`, assistantSenderID).
		Order("create_time ASC, id ASC").
		Find(&pending).Error; err != nil {
		return false, 0, err
	}

	busy := false
	var retryAfter time.Duration
	for i := range pending {
		row := &pending[i]
		requestID := ""
		if row.ClientRequestID != nil {
			requestID = strings.TrimSpace(*row.ClientRequestID)
		}
		if requestID == "" || requestID == excludeRequestID {
			continue
		}

		// Current-format requests carry an explicit hard lease. For older rows or
		// a request whose failed worker released its lease, creation time supplies
		// the same conservative safety window so an active provider is never
		// refunded early.
		expiresAt := row.CreateTime.Add(textTurnLeaseDuration)
		if row.RequestLeaseUntil != nil {
			expiresAt = *row.RequestLeaseUntil
		}
		if expiresAt.After(now) {
			busy = true
			if wait := expiresAt.Sub(now); wait > retryAfter {
				retryAfter = wait
			}
			continue
		}

		// Consume the stale lease before writing its terminal assistant. The row
		// lock plus this CAS means a late original worker either completes first,
		// or loses ownership and can no longer persist/refund after we commit.
		claim := tx.Model(&model.IMMessage{}).Where("id = ?", row.ID)
		if row.RequestLeaseToken != nil {
			claim = claim.
				Where("request_lease_token = ?", *row.RequestLeaseToken).
				Where("request_lease_until IS NOT NULL AND request_lease_until <= ?", now)
		} else {
			claim = claim.
				Where("request_lease_token IS NULL").
				Where("(request_lease_until IS NOT NULL AND request_lease_until <= ?) OR (request_lease_until IS NULL AND create_time <= ?)", now, now.Add(-textTurnLeaseDuration))
		}
		cleanupToken := idgen.Next()
		claimed := claim.Updates(map[string]any{
			"request_lease_until": now,
			"request_lease_token": cleanupToken,
		})
		if claimed.Error != nil {
			return false, 0, claimed.Error
		}
		if claimed.RowsAffected != 1 {
			// The lease changed after our read. Treat it as live; the next pass will
			// observe either its terminal assistant or its new expiry.
			busy = true
			if retryAfter < time.Second {
				retryAfter = time.Second
			}
			continue
		}

		assistantRequestID := requestID
		assistant := &model.IMMessage{
			ConversationID: conversationID,
			SenderID:       assistantSenderID,
			// Operational terminal states render in history but must not become
			// conversational context for the next model call.
			ContentType:     "system",
			Content:         interruptedTextReply,
			Status:          0,
			ClientRequestID: &assistantRequestID,
		}
		if err := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(assistant).Error; err != nil {
			return false, 0, err
		}
		persisted, err := messageByClientRequestDB(tx, conversationID, assistantSenderID, requestID)
		if err != nil {
			return false, 0, err
		}
		if persisted == nil {
			return false, 0, fmt.Errorf("chat: failed to terminalize expired request %q", requestID)
		}
		if err := refundTextCallDB(tx, textChargeFromMessage(row, ownerID)); err != nil {
			return false, 0, err
		}
		if err := tx.Model(&model.IMMessage{}).
			Where("id = ? AND request_lease_token = ?", row.ID, cleanupToken).
			Updates(map[string]any{
				"request_lease_until": nil,
				"request_lease_token": nil,
			}).Error; err != nil {
			return false, 0, err
		}
		if err := tx.Model(&model.IMConversation{}).
			Where("id = ?", conversationID).
			Updates(map[string]any{
				"last_message_id": persisted.ID,
				"last_message_at": persisted.CreateTime,
			}).Error; err != nil {
			return false, 0, err
		}
	}
	return busy, retryAfter, nil
}

// claimExpiredTextRequest atomically transfers an expired generation lease to
// this process. It is safe across application instances because only one
// conditional UPDATE can affect the row.
func (r *repo) claimExpiredTextRequest(messageID, conversationID, ownerID idgen.ID, clientRequestID string, now, leaseUntil time.Time, leaseToken idgen.ID) (bool, error) {
	res := r.db.Model(&model.IMMessage{}).
		Where("id = ? AND conversation_id = ? AND sender_id = ? AND client_request_id = ?", messageID, conversationID, ownerID, clientRequestID).
		Where("request_lease_until IS NULL OR request_lease_until <= ?", now).
		Updates(map[string]any{"request_lease_until": leaseUntil, "request_lease_token": leaseToken})
	if res.Error != nil {
		return false, res.Error
	}
	return res.RowsAffected == 1, nil
}

// releaseTextRequestLease makes a failed durable request immediately claimable
// by a retry. The charge metadata and request snapshot remain intact.
func (r *repo) releaseTextRequestLease(messageID, leaseToken idgen.ID) error {
	if messageID == 0 || leaseToken == 0 {
		return nil
	}
	return r.db.Model(&model.IMMessage{}).
		Where("id = ? AND request_lease_token = ?", messageID, leaseToken).
		Updates(map[string]any{"request_lease_until": nil, "request_lease_token": nil}).Error
}

// completeTextRequest persists (or loads) the one assistant row and clears the
// user lease in one transaction. Returning the row loaded from the database
// prevents a duplicate-key race from ever becoming a phantom SSE completion.
func (r *repo) completeTextRequest(userMessageID, leaseToken idgen.ID, aiMsg *model.IMMessage) (*model.IMMessage, error) {
	return r.completeTextRequestWithFinalize(userMessageID, leaseToken, aiMsg, nil)
}

// completeTextRequestWithFinalize first consumes the current lease with a CAS,
// then persists the assistant and optional billing finalizer in the same
// transaction. The ordering is critical: after an expired lease is transferred,
// the old worker must not insert an assistant or refund the new owner's call.
func (r *repo) completeTextRequestWithFinalize(userMessageID, leaseToken idgen.ID, aiMsg *model.IMMessage, finalize func(*gorm.DB) error) (*model.IMMessage, error) {
	if aiMsg == nil {
		return nil, errors.New("chat: assistant message is nil")
	}
	if aiMsg.ID == 0 {
		aiMsg.ID = idgen.Next()
	}
	var persisted *model.IMMessage
	err := r.db.Transaction(func(tx *gorm.DB) error {
		if userMessageID != 0 && leaseToken != 0 {
			claimed := tx.Model(&model.IMMessage{}).
				Where("id = ? AND request_lease_token = ?", userMessageID, leaseToken).
				Updates(map[string]any{"request_lease_until": nil, "request_lease_token": nil})
			if claimed.Error != nil {
				return claimed.Error
			}
			if claimed.RowsAffected != 1 {
				// A different worker owns the request now. Returning an already
				// durable assistant is safe, but a stale owner may never create one.
				if aiMsg.ClientRequestID != nil && strings.TrimSpace(*aiMsg.ClientRequestID) != "" {
					requestID := strings.TrimSpace(*aiMsg.ClientRequestID)
					var err error
					persisted, err = messageByClientRequestDB(tx, aiMsg.ConversationID, aiMsg.SenderID, requestID)
					if err != nil {
						return err
					}
					if persisted != nil {
						return nil
					}
				}
				return errTextTurnLeaseLost
			}
		}
		if aiMsg.ClientRequestID == nil || strings.TrimSpace(*aiMsg.ClientRequestID) == "" {
			if err := tx.Create(aiMsg).Error; err != nil {
				return err
			}
			persisted = aiMsg
		} else {
			requestID := strings.TrimSpace(*aiMsg.ClientRequestID)
			if err := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(aiMsg).Error; err != nil {
				return err
			}
			var err error
			persisted, err = messageByClientRequestDB(tx, aiMsg.ConversationID, aiMsg.SenderID, requestID)
			if err != nil {
				return err
			}
			if persisted == nil {
				return fmt.Errorf("chat: assistant request %q was not persisted", requestID)
			}
		}
		if finalize != nil {
			if err := finalize(tx); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return persisted, nil
}

// createTurn atomically inserts a 生成台 turn's two messages (user prompt +
// assistant task pointer). The generation task row is locked first, making
// taskId the idempotency key for this conversation: if the first HTTP response
// is lost after commit, a retry returns the already-persisted pair instead of
// inserting a duplicate turn. The same row lock serializes concurrent retries
// across application instances that share the database.
//
// Ids are snowflake-assigned on insert; the assistant row's larger id keeps it
// ordered after the user row (studio-design §9.2).
func (r *repo) createTurn(ownerID, taskID idgen.ID, userMsg, aiMsg *model.IMMessage) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		// All message-producing paths take the conversation lock first. In
		// particular, a paid media turn must not be inserted between an in-flight
		// text request and its assistant: that would persist the role order as
		// user(A), user(B), assistant(A) and corrupt every later model context.
		var conversation model.IMConversation
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Select("id", "owner_id").
			Where("id = ? AND owner_id = ?", userMsg.ConversationID, ownerID).
			First(&conversation).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return ErrNotFound
			}
			return err
		}

		// Ownership was checked by the service before entering this method. Lock
		// the durable task row as well so two ambiguous-response retries cannot
		// both pass the existence check and create two turns.
		var task model.AiTask
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Select("id").
			Where("id = ? AND user_id = ?", taskID, ownerID).
			First(&task).Error; err != nil {
			return err
		}

		var existingAI model.IMMessage
		err := tx.Where("conversation_id = ? AND task_id = ?", aiMsg.ConversationID, taskID).
			Order("id ASC").
			First(&existingAI).Error
		if err == nil {
			// The endpoint contract returns both rows. The original user row is
			// the nearest matching owner text before the assistant task pointer.
			// Matching content+params first preserves the exact original turn even
			// if another chat write happened concurrently in the conversation.
			var existingUser model.IMMessage
			userQuery := tx.Where(
				"conversation_id = ? AND sender_id = ? AND content_type = ? AND id < ?",
				userMsg.ConversationID,
				ownerID,
				"text",
				existingAI.ID,
			)
			findErr := userQuery.
				Where("content = ? AND params = ?", userMsg.Content, userMsg.Params).
				Order("id DESC").
				First(&existingUser).Error
			if errors.Is(findErr, gorm.ErrRecordNotFound) {
				findErr = userQuery.Order("id DESC").First(&existingUser).Error
			}
			if findErr != nil {
				return findErr
			}
			*userMsg = existingUser
			*aiMsg = existingAI
			return nil
		}
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}

		// Idempotent retries above are reads of an already-committed turn and are
		// always safe. A genuinely new turn, however, must wait for the current
		// text lease (or atomically settle an expired one) before it can establish
		// its place in conversation history.
		busy, _, err := reconcileTextRequestsDB(tx, userMsg.ConversationID, ownerID, "", time.Now())
		if err != nil {
			return err
		}
		if busy {
			return errConversationBusy
		}

		if err := tx.Create(userMsg).Error; err != nil {
			return err
		}
		return tx.Create(aiMsg).Error
	})
}

// tasksByIDs batch-loads the generation tasks referenced by 生成台 assistant
// messages, selecting ONLY the columns the message VO renders — the AiTask row
// also carries large input/result blobs we must not pull every poll (§9.3).
// ownerID 过滤是纵深防御：TaskID 虽由 persistTurn 校验归属后写入，但历史脏数据
// （修复前挂进来的他人任务）不该借这条 join 泄露结果，不属于本人的一律按
// 「已过期」处理（map 缺项）。
func (r *repo) tasksByIDs(ids []idgen.ID, ownerID idgen.ID) (map[idgen.ID]*model.AiTask, error) {
	out := make(map[idgen.ID]*model.AiTask, len(ids))
	if len(ids) == 0 {
		return out, nil
	}
	var rows []model.AiTask
	if err := r.db.Model(&model.AiTask{}).
		Select("id", "status", "progress", "result_url", "result_meta", "error_msg").
		Where("id IN ? AND user_id = ?", ids, ownerID).
		Find(&rows).Error; err != nil {
		return nil, err
	}
	for i := range rows {
		out[rows[i].ID] = &rows[i]
	}
	return out, nil
}

func (r *repo) skillRunsByIDs(ids []idgen.ID, ownerID idgen.ID) (map[idgen.ID]*model.SkillRun, error) {
	out := make(map[idgen.ID]*model.SkillRun, len(ids))
	if len(ids) == 0 {
		return out, nil
	}
	var rows []model.SkillRun
	if err := r.db.Model(&model.SkillRun{}).
		Select("id", "skill_id", "status", "current_step", "progress", "pending_action", "error_message", "point_cost").
		Where("id IN ? AND user_id = ?", ids, ownerID).Find(&rows).Error; err != nil {
		return nil, err
	}
	for i := range rows {
		out[rows[i].ID] = &rows[i]
	}
	return out, nil
}

// taskOwnedBy reports whether the generation task exists AND belongs to userID.
// persistTurn 的归属闸门：taskId 由客户端上送，不校验会让任意用户把他人任务挂进
// 自己的会话，再经消息列表的 task join 读走他人生成结果。
func (r *repo) taskOwnedBy(taskID, userID idgen.ID) (bool, error) {
	var n int64
	if err := r.db.Model(&model.AiTask{}).
		Where("id = ? AND user_id = ?", taskID, userID).
		Count(&n).Error; err != nil {
		return false, err
	}
	return n > 0, nil
}

// recentMessages returns up to limit of a conversation's most recent messages in
// chronological (oldest-first) order, for use as LLM context. Messages already
// covered by the compaction summary (id <= afterID) are excluded — they enter
// the prompt as the summary instead. It fetches the newest `limit` rows (DESC)
// then reverses them so the transcript reads forward.
// 只取非空文本：生成 turn 的助手消息 Content=""（结果在 task 上），混进上下文
// 会成为空 assistant 轮次——部分 OpenAI 兼容上游直接拒绝空 content。
func (r *repo) recentMessages(conversationID, afterID, throughID idgen.ID, limit int) ([]model.IMMessage, error) {
	if limit <= 0 {
		limit = 20
	}
	var rows []model.IMMessage
	query := r.db.
		Where("conversation_id = ? AND id > ? AND content <> '' AND (content_type = ? OR (content_type = ? AND EXISTS (SELECT 1 FROM skill_run_artifact sra WHERE sra.run_id = im_message.skill_run_id AND sra.deleted IS NULL AND sra.is_final = ? AND sra.text_content <> '')))", conversationID, afterID, "text", "skill_run", true).
		Where("id <= ?", throughID)
	if err := query.
		Order("create_time DESC").
		Order("id DESC").
		Limit(limit).
		Find(&rows).Error; err != nil {
		return nil, err
	}
	for i, j := 0, len(rows)-1; i < j; i, j = i+1, j-1 {
		rows[i], rows[j] = rows[j], rows[i]
	}
	return rows, nil
}

// textMessagesAfter returns a conversation's text messages with id > afterID,
// oldest-first (id / sender / content only) — the token-estimate and compaction
// source. Media messages carry empty content / URLs and are skipped. 上下文由
// 压缩+上限双重约束，摘要之后的原文消息量始终有限。
func (r *repo) textMessagesAfter(conversationID, afterID idgen.ID) ([]model.IMMessage, error) {
	var rows []model.IMMessage
	err := r.db.Model(&model.IMMessage{}).
		Select("id", "sender_id", "content").
		Where("conversation_id = ? AND id > ? AND content <> '' AND (content_type = ? OR (content_type = ? AND EXISTS (SELECT 1 FROM skill_run_artifact sra WHERE sra.run_id = im_message.skill_run_id AND sra.deleted IS NULL AND sra.is_final = ? AND sra.text_content <> '')))", conversationID, afterID, "text", "skill_run", true).
		Order("id ASC").
		Find(&rows).Error
	return rows, err
}

// saveContextSummary persists the compaction result: the rolled-up summary and
// the last message id it covers.
func (r *repo) saveContextSummary(id idgen.ID, summary string, uptoID idgen.ID) error {
	return r.db.Model(&model.IMConversation{}).
		Where("id = ?", id).
		Updates(map[string]any{
			"context_summary": summary,
			"summary_upto_id": uptoID,
		}).Error
}

// touchConversation updates a conversation's last-message pointer/time so the
// list ordering reflects recent activity.
// renameConversation sets a conversation's title.
func (r *repo) renameConversation(id idgen.ID, title string) error {
	return r.db.Model(&model.IMConversation{}).
		Where("id = ?", id).
		Update("title", title).Error
}

func (r *repo) touchConversation(id, lastMessageID idgen.ID, at time.Time) error {
	return r.db.Model(&model.IMConversation{}).
		Where("id = ?", id).
		Updates(map[string]any{
			"last_message_id": lastMessageID,
			"last_message_at": at,
		}).Error
}
