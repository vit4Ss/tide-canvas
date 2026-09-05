package chat

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"gorm.io/gorm"

	"tidecanvas/internal/config"
	"tidecanvas/internal/handler/ai"
	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/boundedtext"
	"tidecanvas/internal/pkg/chatattach"
	"tidecanvas/internal/pkg/chatcontext"
	"tidecanvas/internal/pkg/eventlog"
	"tidecanvas/internal/pkg/idgen"
	"tidecanvas/internal/pkg/logger"
	"tidecanvas/internal/pkg/relaychat"
	"tidecanvas/internal/pkg/storage"

	"go.uber.org/zap"
)

// service.go holds the chat business logic: ownership scoping, conversation
// creation, message persistence and the canned assistant reply.

// defaultConversationTitle is assigned when a conversation is created without a
// title.
const defaultConversationTitle = "新对话"

// titleFromPrompt derives a short conversation title from the first prompt.
func titleFromPrompt(p string) string {
	p = strings.TrimSpace(p)
	if p == "" {
		return defaultConversationTitle
	}
	r := []rune(p)
	if len(r) > 16 {
		return string(r[:16]) + "…"
	}
	return string(r)
}

// assistantSenderID is the sentinel sender used for the placeholder assistant
// messages. Real users always have a non-zero snowflake id, so a sender id of 0
// unambiguously marks a message as "ai" when the VO derives the role.
const assistantSenderID idgen.ID = 0

// cannedReply is the placeholder assistant response returned until a real LLM is
// wired in. It is intentionally explicit that no model is connected yet.
const cannedReply = "[占位回复] AI 暂未接入：当前还没有配置大模型密钥，这是一条自动生成的占位回复。你的消息已收到：%s"

// interruptedTextReply is the durable terminal state for an idempotent text
// turn whose hard lease expired after its worker disappeared. Keeping the same
// clientRequestId lets every browser reconcile the original optimistic turn;
// textChargeFromMessage is refunded in the same transaction that writes it.
const interruptedTextReply = "上次回复因服务中断未能完成；如有积分消耗，已自动退还。请重新发送。"

// errForbidden is returned when a user tries to access a conversation they do
// not own. The handler maps it to a 404 to avoid leaking existence.
var errForbidden = errors.New("chat: not owner")

// errContextFull is returned when a conversation's cumulative estimated tokens
// reached the configured cap; the user must start a new conversation.
var errContextFull = errors.New("chat: context token limit reached")

var errModelMaintenance = errors.New("chat: model under maintenance")

const modelMaintenanceMessage = "该渠道维护中，暂不可用"

func (s *service) validateTextModelAvailability(requested string) error {
	selected := s.repo.resolveTextModel(requested)
	if selected != nil && model.ModelConfigUnderMaintenance(selected.Config) {
		return errModelMaintenance
	}
	return nil
}

var errInvalidSkill = errors.New("chat: invalid skill")

var errInvalidClientRequestID = errors.New("chat: invalid client request id")

var errConversationBusy = errors.New("chat: conversation has an unfinished turn")

func validateClientRequestID(value string) error {
	if value == "" {
		return nil // optional for legacy callers
	}
	if strings.TrimSpace(value) != value || utf8.RuneCountInString(value) > 96 {
		return errInvalidClientRequestID
	}
	return nil
}

// errTextTurnInProgress means a retry-safe clientRequestId already owns a
// persisted user row, while its assistant row is not durable yet. The HTTP
// layer tells the browser to attach/poll instead of starting and charging a
// second text generation.
var errTextTurnInProgress = errors.New("chat: text turn is still in progress")

// errTextTurnLeaseLost means this worker's lease expired and was transferred
// before it could commit. It is intentionally mapped to retryable pending at
// the service boundary; the stale worker must not mutate durable state.
var errTextTurnLeaseLost = errors.New("chat: text turn lease ownership lost")

type textTurnPendingError struct {
	retryAfter time.Duration
	cause      error
}

func (e *textTurnPendingError) Error() string {
	if e.cause != nil {
		return e.cause.Error()
	}
	return errTextTurnInProgress.Error()
}

func (e *textTurnPendingError) Unwrap() error { return errTextTurnInProgress }

func pendingTextTurn(retryAfter time.Duration, cause error) error {
	if retryAfter < time.Second {
		retryAfter = time.Second
	}
	return &textTurnPendingError{retryAfter: retryAfter, cause: cause}
}

func textTurnRetryAfter(err error) time.Duration {
	var pending *textTurnPendingError
	if errors.As(err, &pending) {
		return pending.retryAfter
	}
	return textTurnLeaseDuration
}

// llmReplyTimeout is the OUTER bound on one upstream generation — a backstop for
// a provider that hangs without ever closing the connection, not the liveness
// check. 判活由 relaychat 的空闲看门狗做；relay 的 SSE 心跳会在模型长时间思考
// 时持续续命，因此这里给慢推理模型完整的一小时硬上限。
//
// 原值 180s 是拿总时长当判活用的，长回复正在正常输出也会被拦腰截断（实测一条
// 已收 29KB 仍被掐，上游随即报 Broken pipe）。还在吐字或收到心跳就让它写完，
// 真卡死则由空闲看门狗结束，不必等到这个上限。
const llmReplyTimeout = 60 * time.Minute

// textTurnLeaseDuration is deliberately longer than the provider's hard
// timeout. An active instance therefore cannot be overtaken, while a crashed
// instance leaves a request that another process can eventually reclaim.
const textTurnLeaseDuration = llmReplyTimeout + 5*time.Minute

type service struct {
	repo *repo
	// relay is the assistant backend: the ScarecrowToken relay's
	// OpenAI-compatible chat completions, routed to a configured text model.
	// nil when no relay API key is set (回复退化为占位文案)。
	relay        *relaychat.Client
	systemPrompt string
	// ctxTokenLimit caps the recent history plus the current prompt (see
	// tokens.go); text sends beyond it fail with errContextFull.
	ctxTokenLimit int
	// docHosts 是启动时存储策略 FetchHosts() 的本站资产 host 列表（CDN/区域/
	// 加速域名），文档附件解析(docextract)只允许抓取这些 host 或
	// *.aliyuncs.com 的 URL（SSRF 防护）。
	docHosts []string
	// store 用于把发给上游模型的图片 URL 改写为传输加速域名（UpstreamURL）——
	// 境外上游取图走区域/CDN 域名会超时。
	store storage.StorageStrategy
	// live 注册表：(会话, clientRequestId) → 生成中的回复缓存（断开重连
	// 续播，见 live.go）。请求级键防止任何附着方读到另一轮的增量。
	liveMu sync.Mutex
	live   map[liveReplyKey]*liveReply
}

func newService(db *gorm.DB, cfg *config.Config, store storage.StorageStrategy) *service {
	s := &service{
		repo:          newRepo(db),
		systemPrompt:  cfg.LLM.SystemPrompt,
		ctxTokenLimit: cfg.LLM.ContextTokenLimit,
		relay:         relaychat.New(cfg.Relay.BaseURL, cfg.Relay.APIKey),
		live:          map[liveReplyKey]*liveReply{},
	}
	if store != nil {
		s.store = store
		s.docHosts = store.FetchHosts()
	}
	if s.ctxTokenLimit <= 0 {
		s.ctxTokenLimit = 32000
	}
	// 把会话上下文上限暴露到后台「配置管理」（首启以配置文件值种入 sys_config；
	// 之后后台是数据源，contextLimit() 每次实时读取，改后无需重启）。
	var seed model.SysConfig
	if err := db.Where(model.SysConfig{ConfigKey: model.ConfigKeyChatContextTokenLimit}).
		Attrs(model.SysConfig{
			ConfigValue: strconv.Itoa(s.ctxTokenLimit),
			Group:       "AI 对话",
			Description: "单次对话上下文 token 估算上限：只计最近 3 条历史文本与本次输入，不再自动压缩（保存即生效）",
		}).FirstOrCreate(&seed).Error; err != nil {
		logger.L().Warn("chat: seed context-limit config failed", zap.Error(err))
	}
	if s.relay != nil {
		logger.L().Info("chat: relay assistant enabled (text models via /v1/chat/completions)")
	}
	return s
}

// listConversations returns a page of the authenticated owner's conversations.
func (s *service) listConversations(ownerID idgen.ID, q *ListQuery) ([]ConversationVO, int64, error) {
	rows, total, err := s.repo.listConversations(ownerID, q)
	if err != nil {
		return nil, 0, err
	}
	vos := make([]ConversationVO, 0, len(rows))
	for i := range rows {
		vos = append(vos, toConversationVO(&rows[i]))
	}
	return vos, total, nil
}

// createConversation makes a new AI conversation owned by ownerID and registers
// the owner as its sole member.
func (s *service) createConversation(ownerID idgen.ID, dto CreateConversationDTO) (*ConversationVO, error) {
	title := strings.TrimSpace(dto.Title)
	if title == "" {
		title = defaultConversationTitle
	}

	conv := &model.IMConversation{
		Type:    "ai",
		Title:   title,
		OwnerID: ownerID,
	}
	if err := s.repo.createConversation(conv); err != nil {
		return nil, err
	}

	// Register the owner as a member (role 2 = 群主/owner). A failure here is not
	// fatal to the conversation itself; the member row only drives unread state.
	_ = s.repo.createMessageMember(conv.ID, ownerID)

	vo := toConversationVO(conv)
	return &vo, nil
}

// renameConversation updates a conversation's title, enforcing ownership.
func (s *service) renameConversation(conversationID, ownerID idgen.ID, title string) (*ConversationVO, error) {
	conv, err := s.repo.findConversation(conversationID)
	if err != nil {
		return nil, err
	}
	if conv.OwnerID != ownerID {
		return nil, errForbidden
	}
	title = strings.TrimSpace(title)
	if title == "" {
		title = defaultConversationTitle
	}
	if err := s.repo.updateConversationTitle(conversationID, title); err != nil {
		return nil, err
	}
	conv.Title = title
	vo := toConversationVO(conv)
	return &vo, nil
}

// deleteConversation removes a conversation (and its messages), enforcing ownership.
func (s *service) deleteConversation(conversationID, ownerID idgen.ID) error {
	conv, err := s.repo.findConversation(conversationID)
	if err != nil {
		return err
	}
	if conv.OwnerID != ownerID {
		return errForbidden
	}
	return s.repo.deleteConversation(conversationID)
}

// listMessages returns a page of a conversation's messages, enforcing ownership.
func (s *service) listMessages(conversationID, ownerID idgen.ID, q *ListQuery) ([]MessageVO, int64, error) {
	conv, err := s.repo.findConversation(conversationID)
	if err != nil {
		return nil, 0, err
	}
	if conv.OwnerID != ownerID {
		return nil, 0, errForbidden
	}
	// Loading history is also the crash-recovery trigger. Unlike a browser
	// journal, this durable path has no TTL: once the provider's hard lease is
	// safely past, the request is terminalized and refunded exactly once.
	if err := s.repo.reconcileExpiredTextRequests(conversationID, ownerID, time.Now()); err != nil {
		return nil, 0, err
	}

	rows, total, err := s.repo.listMessages(conversationID, q)
	if err != nil {
		return nil, 0, err
	}
	vos := make([]MessageVO, 0, len(rows))
	for i := range rows {
		vos = append(vos, toMessageVO(&rows[i], conv.OwnerID))
	}

	// Attach live task status to assistant messages that point to a task (the
	// task is the single source of truth). One batched IN query, no N+1.
	var taskIDs []idgen.ID
	for i := range vos {
		if vos[i].TaskID != nil {
			taskIDs = append(taskIDs, *vos[i].TaskID)
		}
	}
	if len(taskIDs) > 0 {
		if tasks, terr := s.repo.tasksByIDs(taskIDs, ownerID); terr == nil {
			for i := range vos {
				if vos[i].TaskID != nil {
					vos[i].Task = toMessageTaskVO(tasks[*vos[i].TaskID]) // nil → 已过期 on the client
				}
			}
		}
	}
	var runIDs []idgen.ID
	for i := range vos {
		if vos[i].SkillRunID != nil {
			runIDs = append(runIDs, *vos[i].SkillRunID)
		}
	}
	if len(runIDs) > 0 {
		if runs, runErr := s.repo.skillRunsByIDs(runIDs, ownerID); runErr == nil {
			for i := range vos {
				if vos[i].SkillRunID != nil {
					vos[i].SkillRun = toMessageSkillRunVO(runs[*vos[i].SkillRunID])
				}
			}
		}
	}
	return vos, total, nil
}

// persistTurn atomically records a completed 生成台 turn: the user's prompt (with
// its param snapshot) and an assistant message that points at the generation
// task. No auto text reply. The task itself was already submitted via the ai
// pipeline, so billing/quota are not re-implemented here (studio-design §9.2, §10.8).
func (s *service) persistTurn(conversationID, ownerID idgen.ID, dto PersistTurnDTO, taskID idgen.ID) ([]MessageVO, error) {
	conv, err := s.repo.findConversation(conversationID)
	if err != nil {
		return nil, err
	}
	if conv.OwnerID != ownerID {
		return nil, errForbidden
	}
	// taskId 由客户端上送：必须校验该任务属于当前用户，否则任何人都能把他人
	// 任务挂进自己的会话，再经消息列表的 task join 读走他人生成结果（越权）。
	if owned, terr := s.repo.taskOwnedBy(taskID, ownerID); terr != nil {
		return nil, terr
	} else if !owned {
		return nil, errForbidden
	}

	contentType := strings.TrimSpace(dto.ContentType)
	if contentType != "video" && contentType != "audio" {
		contentType = "image"
	}

	userMsg := &model.IMMessage{
		ConversationID: conversationID,
		SenderID:       ownerID,
		ContentType:    "text",
		Content:        strings.TrimSpace(dto.Prompt),
		Params:         strings.TrimSpace(string(dto.Params)),
		Status:         0,
	}
	aiMsg := &model.IMMessage{
		ConversationID: conversationID,
		SenderID:       assistantSenderID,
		ContentType:    contentType,
		Content:        "",
		TaskID:         &taskID,
		Status:         0,
	}
	if err := s.repo.createTurn(ownerID, taskID, userMsg, aiMsg); err != nil {
		return nil, err
	}

	at := time.Now()
	_ = s.repo.touchConversation(conversationID, aiMsg.ID, at)
	// First turn names the conversation from the prompt (best-effort).
	if strings.TrimSpace(conv.Title) == "" || conv.Title == defaultConversationTitle {
		_ = s.repo.renameConversation(conversationID, titleFromPrompt(userMsg.Content))
	}

	return []MessageVO{
		toMessageVO(userMsg, conv.OwnerID),
		toMessageVO(aiMsg, conv.OwnerID),
	}, nil
}

// contextTokens estimates only the three messages used by the next text turn.
// Legacy summaries and earlier messages remain stored but are never injected.
func (s *service) contextTokens(conv *model.IMConversation) (int, error) {
	rows, err := s.repo.recentMessages(conv.ID, 0, chatcontext.HistoryLimit)
	if err != nil {
		return 0, err
	}
	used := 0
	for i := range rows {
		used += estimateTokens(rows[i].Content)
	}
	return used, nil
}

// contextUsage reports a conversation's estimated context usage vs the cap,
// enforcing ownership. The frontend uses it to warn near the limit and to
// prompt for a new conversation once full.
func (s *service) contextUsage(conversationID, ownerID idgen.ID) (*ContextUsageVO, error) {
	conv, err := s.repo.findConversation(conversationID)
	if err != nil {
		return nil, err
	}
	if conv.OwnerID != ownerID {
		return nil, errForbidden
	}
	used, err := s.contextTokens(conv)
	if err != nil {
		return nil, err
	}
	vo := toContextUsageVO(used, s.contextLimit(), false)
	return &vo, nil
}

// contextLimit returns the effective conversation token cap: the admin
// 配置管理 override (sys_config llm.contextTokenLimit) when it holds a positive
// integer, else the boot config value. Read per call —— 单行唯一键查询开销可忽略，
// 换来后台改完即时生效、无需重启。
func (s *service) contextLimit() int {
	var row model.SysConfig
	if err := s.repo.db.Where("config_key = ?", model.ConfigKeyChatContextTokenLimit).
		First(&row).Error; err == nil {
		if n, convErr := strconv.Atoi(strings.TrimSpace(row.ConfigValue)); convErr == nil && n > 0 {
			return n
		}
	}
	return s.ctxTokenLimit
}

// guardContext rejects a new text turn once the conversation's estimated
// tokens (effective transcript + the new message) exceed the cap. A failed
// estimate fails open — the cap is a UX guardrail, not billing enforcement.
// The transcript is retained in storage; it is neither compacted nor re-sent.
func (s *service) guardContext(conv *model.IMConversation, newContent string) error {
	used, err := s.contextTokens(conv)
	if err != nil {
		logger.L().Warn("chat: context estimate failed, skipping cap", zap.Error(err))
		return nil
	}
	if used+estimateTokens(newContent) > s.contextLimit() {
		return errContextFull
	}
	return nil
}

// sendMessage persists a user turn, generates its reply and verifies ownership.
func (s *service) sendMessage(ctx context.Context, conversationID, ownerID idgen.ID, dto SendMessageDTO) (*MessageVO, error) {
	conv, err := s.repo.findConversation(conversationID)
	if err != nil {
		return nil, err
	}
	if conv.OwnerID != ownerID {
		return nil, errForbidden
	}

	contentType := strings.TrimSpace(dto.Type)
	if contentType == "" {
		contentType = "text"
	}
	content := strings.TrimSpace(dto.Content)
	preset, err := s.resolveChatPreset(ctx, dto.SkillID)
	if err != nil {
		return nil, err
	}
	if preset != nil {
		dto.Model = presetModel(preset, dto.Model)
	}
	if err := s.validateTextModelAvailability(dto.Model); err != nil {
		return nil, err
	}
	skillPrompt, err := presetPrompt(preset, content)
	if err != nil {
		return nil, errInvalidSkill
	}
	if err := s.validateTextAttachments(dto.Attachments, dto.Model); err != nil {
		return nil, err
	}
	if err := s.guardContext(conv, content); err != nil {
		return nil, err
	}
	imageURLs := s.imageAttachmentURLs(dto.Attachments)
	docFiles, docNote := s.docFileParts(ctx, dto.Attachments)

	// 按次计费:relay 可用时按所选文本模型目录价预扣,余额不足直接拒发
	// (消息不落库);上游失败在 generateReply 里原额退款。
	var charge *textCharge
	if s.relay != nil {
		if charge, err = s.chargeTextCall(ctx, ownerID, dto.Model); err != nil {
			return nil, err
		}
	}

	// Persist the user message (attachments snapshotted on Params for redisplay).
	userMsg := &model.IMMessage{
		ConversationID: conversationID,
		SenderID:       ownerID,
		ContentType:    contentType,
		Content:        content,
		Params:         attachmentsParams(dto.Attachments),
		Status:         0,
	}
	if err := s.repo.createMessage(userMsg); err != nil {
		s.refundTextCall(charge)
		return nil, err
	}
	if preset != nil {
		_ = s.repo.db.Model(&model.Skill{}).Where("id = ? AND status = 1", preset.SkillID).
			UpdateColumn("use_count", gorm.Expr("use_count + 1")).Error
	}

	// Generate the assistant reply (real LLM when configured, canned otherwise).
	// A failure to store the reply must not fail the user's send, so it is
	// best-effort. 空回复（请求被取消时 generateReply 返回 ""）不落库——
	// 否则断开的请求会往会话里塞一条空/占位气泡。
	reply := s.generateReply(ctx, conv, ownerID, userMsg.ID, content, docNote, docFiles, imageURLs, dto.Model, skillPrompt, dto.WebSearch, charge)
	at := time.Now()
	if strings.TrimSpace(reply) != "" {
		aiMsg := &model.IMMessage{
			ConversationID: conversationID,
			SenderID:       assistantSenderID,
			ContentType:    "text",
			Content:        reply,
			Status:         0,
		}
		if err := s.repo.createMessage(aiMsg); err == nil {
			_ = s.repo.touchConversation(conversationID, aiMsg.ID, at)
		} else {
			_ = s.repo.touchConversation(conversationID, userMsg.ID, at)
		}
	} else {
		_ = s.repo.touchConversation(conversationID, userMsg.ID, at)
	}

	vo := toMessageVO(userMsg, conv.OwnerID)
	return &vo, nil
}

// claimTextRequestRecovery closes the check→complete→claim race. A winner may
// persist the assistant and clear its user lease after a retry's first
// assistant lookup but before the retry claims NULL; after every successful
// claim we therefore read the assistant again before invoking the provider.
func (s *service) claimTextRequestRecovery(userMsg *model.IMMessage, conversationID, ownerID idgen.ID, clientRequestID string) (*model.IMMessage, bool, time.Duration, error) {
	now := time.Now()
	leaseUntil := now.Add(textTurnLeaseDuration)
	leaseToken := idgen.Next()
	claimed, err := s.repo.claimExpiredTextRequest(userMsg.ID, conversationID, ownerID, clientRequestID, now, leaseUntil, leaseToken)
	if err != nil {
		return nil, false, 0, err
	}
	if !claimed {
		retryAfter := textTurnLeaseDuration
		if userMsg.RequestLeaseUntil != nil {
			retryAfter = time.Until(*userMsg.RequestLeaseUntil)
		}
		return nil, false, retryAfter, nil
	}
	completed, err := s.repo.messageByClientRequest(conversationID, assistantSenderID, clientRequestID)
	if err != nil {
		_ = s.repo.releaseTextRequestLease(userMsg.ID, leaseToken)
		return nil, false, 0, err
	}
	if completed != nil {
		_ = s.repo.releaseTextRequestLease(userMsg.ID, leaseToken)
		return completed, false, 0, nil
	}
	userMsg.RequestLeaseUntil = &leaseUntil
	userMsg.RequestLeaseToken = &leaseToken
	return nil, true, 0, nil
}

// streamMessage persists the user message, streams the assistant reply token by
// token via onDelta, persists the full assistant reply, and returns the
// assistant message VO. Ownership is enforced. When no relay text model is
// available it emits the canned reply as a single delta so the round-trip still
// completes.
func (s *service) streamMessage(ctx context.Context, conversationID, ownerID idgen.ID, content string, attachments []MessageAttach, requestedModel, skillID string, webSearch bool, clientRequestID string, onDelta func(string)) (*MessageVO, error) {
	if err := validateClientRequestID(clientRequestID); err != nil {
		return nil, err
	}
	conv, err := s.repo.findConversation(conversationID)
	if err != nil {
		return nil, err
	}
	if conv.OwnerID != ownerID {
		return nil, errForbidden
	}
	content = strings.TrimSpace(content)
	requestedModel = strings.TrimSpace(requestedModel)
	skillID = strings.TrimSpace(skillID)

	var (
		userMsg          *model.IMMessage
		charge           *textCharge
		skillPrompt      string
		preset           *ai.PublishedPreset
		resuming         bool
		leaseToken       idgen.ID
		persistedRequest textRequestSnapshot
	)
	if clientRequestID != "" {
		// A completed replay returns the original assistant message without a
		// provider call. An incomplete user row carries a cross-instance lease;
		// exactly one retry may claim it after expiry and resume without charging.
		if existing, findErr := s.repo.messageByClientRequest(conversationID, assistantSenderID, clientRequestID); findErr != nil {
			return nil, findErr
		} else if existing != nil {
			vo := toMessageVO(existing, conv.OwnerID)
			return &vo, nil
		}
		if existing, findErr := s.repo.messageByClientRequest(conversationID, ownerID, clientRequestID); findErr != nil {
			return nil, findErr
		} else if existing != nil {
			if existing.RequestLeaseUntil != nil && existing.RequestLeaseUntil.After(time.Now()) {
				return nil, pendingTextTurn(time.Until(*existing.RequestLeaseUntil), nil)
			}
			resuming = true
			userMsg = existing
			content = strings.TrimSpace(existing.Content)
			if snapshot, ok := parseTextRequestSnapshot(existing.RequestSnapshot); ok {
				persistedRequest = snapshot
				attachments = snapshot.Attachments
				requestedModel = snapshot.Model
				skillID = snapshot.SkillID
				skillPrompt = snapshot.SkillPrompt
				webSearch = snapshot.WebSearch
			}
			charge = textChargeFromMessage(existing, ownerID)
		}
	}

	// A current-format recovery uses the private server snapshot and therefore
	// does not depend on a skill still being published. Legacy/in-flight rows
	// without that snapshot are resolved from the exact retry payload.
	if !resuming || persistedRequest.Version == 0 {
		preset, err = s.resolveChatPreset(ctx, skillID)
		if err != nil {
			return nil, err
		}
		if preset != nil {
			requestedModel = presetModel(preset, requestedModel)
		}
		skillPrompt, err = presetPrompt(preset, content)
		if err != nil {
			return nil, errInvalidSkill
		}
	}
	if !resuming {
		if err := s.validateTextModelAvailability(requestedModel); err != nil {
			return nil, err
		}
	}
	if !resuming {
		if err := s.validateTextAttachments(attachments, requestedModel); err != nil {
			return nil, err
		}
	}
	if !resuming {
		if err := s.guardContext(conv, content); err != nil {
			return nil, err
		}
	}

	// image attachments are forwarded as image_url parts; document attachments
	// are fetched and forwarded as relay "file" parts (docextract.go); every
	// attachment is also snapshotted on the user message for redisplay.
	imageURLs := s.imageAttachmentURLs(attachments)
	docFiles, docNote := s.docFileParts(ctx, attachments)
	if resuming {
		completed, claimed, retryAfter, claimErr := s.claimTextRequestRecovery(userMsg, conversationID, ownerID, clientRequestID)
		if claimErr != nil {
			return nil, claimErr
		}
		if completed != nil {
			vo := toMessageVO(completed, conv.OwnerID)
			return &vo, nil
		}
		if !claimed {
			return nil, pendingTextTurn(retryAfter, nil)
		}
		if userMsg.RequestLeaseToken == nil {
			return nil, errors.New("chat: recovered request lease has no owner token")
		}
		leaseToken = *userMsg.RequestLeaseToken
		defer func() {
			if releaseErr := s.repo.releaseTextRequestLease(userMsg.ID, leaseToken); releaseErr != nil {
				logger.L().Error("chat: release recovered text request lease failed",
					zap.String("requestId", clientRequestID), zap.Error(releaseErr))
			}
		}()
	}

	if !resuming {
		userMsg = &model.IMMessage{
			ConversationID: conversationID,
			SenderID:       ownerID,
			ContentType:    "text",
			Content:        content,
			Params:         attachmentsParams(attachments),
		}
		if clientRequestID != "" {
			requestID := clientRequestID
			leaseUntil := time.Now().Add(textTurnLeaseDuration)
			requestLeaseToken := idgen.Next()
			userMsg.ClientRequestID = &requestID
			userMsg.RequestLeaseUntil = &leaseUntil
			userMsg.RequestLeaseToken = &requestLeaseToken
			userMsg.RequestSnapshot = encodeTextRequestSnapshot(textRequestSnapshot{
				Version:     1,
				Attachments: attachments,
				Model:       requestedModel,
				SkillID:     skillID,
				SkillPrompt: skillPrompt,
				WebSearch:   webSearch,
			})
			if s.relay != nil {
				charge = s.prepareTextCharge(ownerID, requestedModel)
			} else {
				charge = &textCharge{ownerID: ownerID}
			}
			userMsg.RequestChargeCost = charge.cost
			if charge.refID != 0 {
				refID := charge.refID
				userMsg.RequestChargeRefID = &refID
			}
			claimed, claimErr := s.repo.claimTextRequest(ctx, userMsg, func(tx *gorm.DB) error {
				return consumeTextCharge(tx, charge)
			})
			if claimErr != nil {
				return nil, claimErr
			}
			if !claimed {
				if existing, findErr := s.repo.messageByClientRequest(conversationID, assistantSenderID, clientRequestID); findErr != nil {
					return nil, findErr
				} else if existing != nil {
					vo := toMessageVO(existing, conv.OwnerID)
					return &vo, nil
				}
				retryAfter := textTurnLeaseDuration
				if userMsg.RequestLeaseUntil != nil {
					retryAfter = time.Until(*userMsg.RequestLeaseUntil)
				}
				return nil, pendingTextTurn(retryAfter, nil)
			}
			leaseToken = requestLeaseToken
			defer func() {
				if releaseErr := s.repo.releaseTextRequestLease(userMsg.ID, leaseToken); releaseErr != nil {
					logger.L().Error("chat: release text request lease failed",
						zap.String("requestId", clientRequestID), zap.Error(releaseErr))
				}
			}()
		} else {
			// Legacy callers without a request key keep their old behavior. New
			// clients always use the transactional durable path above.
			if s.relay != nil {
				if charge, err = s.chargeTextCall(ctx, ownerID, requestedModel); err != nil {
					return nil, err
				}
			}
			if err := s.repo.createMessage(userMsg); err != nil {
				s.refundTextCall(charge)
				return nil, err
			}
		}
	}
	if preset != nil && !resuming {
		_ = s.repo.db.Model(&model.Skill{}).Where("id = ? AND status = 1", preset.SkillID).
			UpdateColumn("use_count", gorm.Expr("use_count + 1")).Error
	}

	// 注册 live 缓存：增量同时进内存缓存,断开的客户端刷新后可通过
	// GET /stream 重新附着续播（见 live.go）。liveEnd 兜底保证任何返回路径
	// 都会终结订阅者的等待。
	lr := s.liveStart(conversationID, clientRequestID)
	defer s.liveEnd(conversationID, clientRequestID, lr)
	reply, refundRequired := s.streamReply(ctx, conv, ownerID, userMsg.ID, content, docNote, docFiles, imageURLs, requestedModel, skillPrompt, webSearch, func(d string) {
		lr.append(d)
		if onDelta != nil {
			onDelta(d)
		}
	}, charge)

	aiMsg := &model.IMMessage{
		ConversationID: conversationID,
		SenderID:       assistantSenderID,
		ContentType:    "text",
		Content:        reply,
	}
	if clientRequestID != "" {
		requestID := clientRequestID
		aiMsg.ClientRequestID = &requestID
	}
	at := time.Now()
	// Never emit a done frame for a row that is not durable. Idempotent callers
	// receive TURN_IN_PROGRESS and may atomically reclaim the released lease;
	// legacy callers receive the persistence error instead of a phantom VO.
	if strings.TrimSpace(reply) == "" {
		_ = s.repo.touchConversation(conversationID, userMsg.ID, at)
		if clientRequestID != "" {
			return nil, pendingTextTurn(time.Second, errors.New("chat: assistant reply is empty"))
		}
		return nil, errors.New("chat: assistant reply is empty")
	}
	var finalize func(*gorm.DB) error
	if refundRequired && clientRequestID != "" {
		finalize = func(tx *gorm.DB) error {
			return refundTextCallDB(tx, charge)
		}
	}
	persistedAI, persistErr := s.repo.completeTextRequestWithFinalize(userMsg.ID, leaseToken, aiMsg, finalize)
	if persistErr != nil {
		_ = s.repo.touchConversation(conversationID, userMsg.ID, at)
		logger.L().Error("chat: persist streamed assistant failed",
			zap.String("requestId", clientRequestID), zap.Error(persistErr))
		if clientRequestID != "" {
			return nil, pendingTextTurn(time.Second, fmt.Errorf("chat: persist assistant: %w", persistErr))
		}
		return nil, persistErr
	}
	if refundRequired && clientRequestID == "" {
		// Legacy callers have no durable lease owner. Delay their best-effort
		// refund until after the fallback assistant is safely persisted.
		s.refundTextCall(charge)
	}
	_ = s.repo.touchConversation(conversationID, persistedAI.ID, at)

	vo := toMessageVO(persistedAI, conv.OwnerID)
	lr.finish(&vo)
	return &vo, nil
}

// streamReply streams the assistant reply for the latest user message via the
// relay text model, forwarding each delta through onDelta. On any error (or when
// no relay text model is configured) it falls back to the canned reply, emitted
// as one delta so the client still renders something. Context is system
// instructions, up to three preceding messages, and the current user message.
func (s *service) streamReply(ctx context.Context, conv *model.IMConversation, ownerID, userMessageID idgen.ID, userContent string, docNote string, docFiles []relaychat.FileAttachment, imageURLs []string, requestedModel, skillPrompt string, webSearch bool, onDelta func(string), charge *textCharge) (string, bool) {
	// 客户端断开不中止生成：前端切页面/切会话都会 abort SSE，请求上下文随之
	// 取消；若生成跟着停，回复只落库半截。分离请求上下文让上游把回复生成完整
	// 并落库，用户切回来能看到全文；llmReplyTimeout 仍然兜底。断开后 onDelta
	// 往已关闭的连接写帧只是静默失败，不影响生成。
	ctx = context.WithoutCancel(ctx)
	conversationID := conv.ID
	if s.relay != nil {
		if model := s.repo.resolveTextModelKey(requestedModel); model != "" {
			if msgs, err := s.replyMessages(conversationID, userMessageID, userContent, docNote, docFiles, imageURLs, skillPrompt); err == nil {
				cctx, cancel := context.WithTimeout(ctx, llmReplyTimeout)
				defer cancel()
				start := time.Now()
				// 记录已推送给客户端的增量：中途失败时以它为准收尾，绝不再叠加
				// 降级回复——否则客户端看到「半截真回复 + 占位文案」，而落库的又是
				// 另一份内容，三方不一致。
				var streamed strings.Builder
				reply, err := s.relay.ChatStreamWithWebSearch(cctx, model, msgs, webSearch, func(d string) {
					streamed.WriteString(d)
					if onDelta != nil {
						onDelta(d)
					}
				})
				// 日志只记当前轮（messages 数组的最后一条即当前 user 消息）:
				// 全量历史会撑爆 eventlog 的 16KB 截断,把末尾的当前轮 prompt/附件
				// 切没;历史轮次本就落在消息表里,审计只需当前输入。附件 base64
				// 净化后再落库:保留文件名/类型。
				turn := msgs
				if n := len(msgs); n > 1 {
					turn = msgs[n-1:]
				}
				reqBody, _ := json.Marshal(turn)
				eventlog.ModelText(ownerID, "chat", model, "/v1/chat/completions", eventlog.SanitizeDataURIs(string(reqBody)), reply, start, err, charge.cost64(), eventlog.ModelTextBillingRef{ID: charge.billingRefID(), Type: "ledger"})
				if err == nil {
					return reply, false
				}
				logger.L().Warn("chat: relay stream failed", zap.String("model", model), zap.Error(err))
				if partial := strings.TrimSpace(streamed.String()); partial != "" {
					// 已流出实质内容（如上游超时/中途出错）：持久化已生成的部分，跳过降级链。
					// 用户已拿到内容,积分照收不退。
					return streamed.String(), false
				}
				// 未产出内容:降级链拿到的回复不计费。退款延迟到
				// assistant 与当前 lease owner 一起原子提交，避免旧 worker
				// 在租约转移后误退新 worker 的成功调用。
				fallbackNeedsRefund := charge != nil && charge.cost > 0 && charge.refID != 0
				fallbackReply := s.buildReply(userContent)
				if onDelta != nil {
					onDelta(fallbackReply)
				}
				return fallbackReply, fallbackNeedsRefund
			}
		}
	}

	reply := s.buildReply(userContent)
	if onDelta != nil {
		onDelta(reply)
	}
	// A paid fence may already exist even when model resolution or history
	// loading fails before ChatStream is reached. No provider call happened, so
	// the durable completion must refund it together with the fallback reply.
	return reply, charge != nil && charge.cost > 0 && charge.refID != 0
}

// imageAttachmentURLs returns the hosted URLs of the image attachments (the only
// kind forwarded to the model as multimodal content). URLs on this site's
// storage are rewritten to the transfer-acceleration host so the overseas
// upstream can fetch them (same rule as generation references, see
// handler/ai provider_relay).
func (s *service) imageAttachmentURLs(atts []MessageAttach) []string {
	urls := chatattach.ImageURLs(toAttaches(atts))
	if s.store != nil {
		for i, u := range urls {
			urls[i] = s.store.UpstreamURL(u)
		}
	}
	return urls
}

func (s *service) resolveChatPreset(ctx context.Context, skillID string) (*ai.PublishedPreset, error) {
	if strings.TrimSpace(skillID) == "" {
		return nil, nil
	}
	preset, err := ai.ResolvePublishedPreset(ctx, s.repo.db, skillID, "chat", "text", "text")
	if err != nil {
		logger.L().Warn("chat: rejected skill preset", zap.String("skillId", skillID), zap.Error(err))
		return nil, errInvalidSkill
	}
	return preset, nil
}

func presetModel(preset *ai.PublishedPreset, requested string) string {
	if preset == nil {
		return strings.TrimSpace(requested)
	}
	if configured := strings.TrimSpace(preset.ModelID); configured != "" {
		return configured
	}
	if requested = strings.TrimSpace(requested); requested != "" {
		return requested
	}
	if value, ok := preset.Defaults["modelId"].(string); ok && strings.TrimSpace(value) != "" {
		return strings.TrimSpace(value)
	}
	return ""
}

func presetPrompt(preset *ai.PublishedPreset, userContent string) (string, error) {
	if preset == nil {
		return "", nil
	}
	return boundedtext.Replace(preset.Prompt, 1<<20, "{{prompt}}", userContent, "{{input.prompt}}", userContent)
}

// attachmentsParams snapshots the composer attachments as a JSON object stored on
// the user message's Params column ({"attachments":[…]}), so the bubble can
// re-render them after a reload. Returns "" when there are none.
func attachmentsParams(atts []MessageAttach) string {
	if len(atts) == 0 {
		return ""
	}
	b, err := json.Marshal(map[string]any{"attachments": atts})
	if err != nil {
		return ""
	}
	return string(b)
}

// textRequestSnapshot is private recovery state for a streamed text turn. It
// lives in IMMessage.RequestSnapshot rather than Params so skill system prompts
// are never exposed through MessageVO.
type textRequestSnapshot struct {
	Version     int             `json:"version"`
	Attachments []MessageAttach `json:"attachments,omitempty"`
	Model       string          `json:"model,omitempty"`
	SkillID     string          `json:"skillId,omitempty"`
	SkillPrompt string          `json:"skillPrompt,omitempty"`
	WebSearch   bool            `json:"webSearch,omitempty"`
}

func encodeTextRequestSnapshot(snapshot textRequestSnapshot) string {
	b, err := json.Marshal(snapshot)
	if err != nil {
		return ""
	}
	return string(b)
}

func parseTextRequestSnapshot(raw string) (textRequestSnapshot, bool) {
	var snapshot textRequestSnapshot
	if strings.TrimSpace(raw) == "" || json.Unmarshal([]byte(raw), &snapshot) != nil || snapshot.Version <= 0 {
		return textRequestSnapshot{}, false
	}
	return snapshot, true
}

func textChargeFromMessage(message *model.IMMessage, ownerID idgen.ID) *textCharge {
	charge := &textCharge{ownerID: ownerID}
	if message == nil || message.RequestChargeCost <= 0 {
		return charge
	}
	charge.cost = message.RequestChargeCost
	if message.RequestChargeRefID != nil {
		charge.refID = *message.RequestChargeRefID
	}
	return charge
}

// appendMessage persists a single message with NO auto assistant reply. Role
// "ai" stores it under the assistant sentinel sender (so toMessageVO marks it as
// an assistant bubble); anything else is the owner's own message. Used by 对话式
// 生成 to log the prompt and the generated media (image/video) result.
func (s *service) appendMessage(conversationID, ownerID idgen.ID, dto AppendMessageDTO) (*MessageVO, error) {
	conv, err := s.repo.findConversation(conversationID)
	if err != nil {
		return nil, err
	}
	if conv.OwnerID != ownerID {
		return nil, errForbidden
	}

	contentType := strings.TrimSpace(dto.Type)
	if contentType == "" {
		contentType = "text"
	}
	sender := ownerID
	if strings.EqualFold(strings.TrimSpace(dto.Role), "ai") {
		sender = assistantSenderID
	}

	msg := &model.IMMessage{
		ConversationID: conversationID,
		SenderID:       sender,
		ContentType:    contentType,
		Content:        strings.TrimSpace(dto.Content),
		Status:         0,
	}
	if err := s.repo.createMessage(msg); err != nil {
		return nil, err
	}
	_ = s.repo.touchConversation(conversationID, msg.ID, time.Now())

	vo := toMessageVO(msg, conv.OwnerID)
	return &vo, nil
}

// generateReply produces the assistant reply for the latest user message: the
// recent transcript goes to the relay text model; on any error (or when the
// relay is unconfigured) it falls back to the canned placeholder so the chat
// round-trip always completes. Context is system instructions, up to three
// preceding messages, and the current persisted user message.
func (s *service) generateReply(ctx context.Context, conv *model.IMConversation, ownerID, userMessageID idgen.ID, userContent string, docNote string, docFiles []relaychat.FileAttachment, imageURLs []string, requestedModel, skillPrompt string, webSearch bool, charge *textCharge) string {
	if s.relay == nil {
		return s.buildReply(userContent)
	}

	msgs, err := s.replyMessages(conv.ID, userMessageID, userContent, docNote, docFiles, imageURLs, skillPrompt)
	if err != nil {
		logger.L().Warn("chat: load context failed, using canned reply", zap.Error(err))
		return s.buildReply(userContent)
	}

	// 1) Preferred: relay chat completions, routed to a configured text model.
	if s.relay != nil {
		if model := s.repo.resolveTextModelKey(requestedModel); model != "" {
			cctx, cancel := context.WithTimeout(ctx, llmReplyTimeout)
			defer cancel()
			start := time.Now()
			reply, err := s.relay.ChatWithWebSearch(cctx, model, msgs, webSearch)
			// 日志只记当前轮（最后一条即当前 user 消息）,附件 base64 净化;
			// 积分随 charge 落 point_cost。
			turn := msgs
			if n := len(msgs); n > 1 {
				turn = msgs[n-1:]
			}
			reqBody, _ := json.Marshal(turn)
			eventlog.ModelText(ownerID, "chat", model, "/v1/chat/completions", eventlog.SanitizeDataURIs(string(reqBody)), reply, start, err, charge.cost64(), eventlog.ModelTextBillingRef{ID: charge.billingRefID(), Type: "ledger"})
			if err == nil {
				return reply
			}
			// 调用失败且未产出内容:退回预扣积分(降级链拿到的回复不再计费)。
			s.refundTextCall(charge)
			logger.L().Warn("chat: relay generation failed, falling back", zap.String("model", model), zap.Error(err))
			if ctx.Err() != nil {
				return "" // 请求已取消（客户端断开）：不再降级空烧，也不落库占位
			}
		}
	}

	// Canned placeholder.
	return s.buildReply(userContent)
}

// buildReply formats the canned assistant reply for a given user message.
func (s *service) buildReply(userContent string) string {
	preview := userContent
	const max = 80
	if len([]rune(preview)) > max {
		preview = string([]rune(preview)[:max]) + "…"
	}
	return strings.Replace(cannedReply, "%s", preview, 1)
}
