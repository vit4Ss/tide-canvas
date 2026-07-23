package chat

import (
	"context"
	"encoding/json"
	"errors"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"

	"gorm.io/gorm"

	"tidecanvas/internal/config"
	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/eventlog"
	"tidecanvas/internal/pkg/idgen"
	"tidecanvas/internal/pkg/llm"
	"tidecanvas/internal/pkg/logger"
	"tidecanvas/internal/pkg/relaychat"

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

// errForbidden is returned when a user tries to access a conversation they do
// not own. The handler maps it to a 404 to avoid leaking existence.
var errForbidden = errors.New("chat: not owner")

// errContextFull is returned when a conversation's cumulative estimated tokens
// reached the configured cap; the user must start a new conversation.
var errContextFull = errors.New("chat: context token limit reached")

// llmReplyTimeout is the OUTER bound on one upstream generation — a backstop for
// a provider that hangs without ever closing the connection, not the liveness
// check. 判活由 relaychat 的空闲看门狗做（连续 90s 没有新字节才断）。
//
// 原值 180s 是拿总时长当判活用的，长回复正在正常输出也会被拦腰截断（实测一条
// 已收 29KB 仍被掐，上游随即报 Broken pipe）。放宽到 10 分钟：还在吐字就让它
// 写完，真卡死则由空闲看门狗在 90s 内结束，不必等到这个上限。
const llmReplyTimeout = 10 * time.Minute

// ── 上下文自动压缩（compaction）────────────────────────────────────────────
// 会话估算 token 越过阈值（默认=上限的 70%，sys_config llm.compressAtTokens
// 可改）时，把「最近 compactKeepTail 条之外」的历史交给文本模型滚动压缩成
// 摘要存到会话上（context_summary / summary_upto_id）；后续请求以
// [system 提示词 + 摘要 + 摘要之后的原文] 作为上下文，会话得以继续而不是
// 撞硬上限被迫开新会话。压缩失败 fail-open，硬上限仍由 guardContext 兜底。

// compactKeepTail 条最近消息永远保留原文（≈3 轮），保证近场语境不失真。
const compactKeepTail = 6

// compactAtMessages 按消息条数触发压缩（与 token 阈值互为兜底）：消息多而短
// 的会话 token 迟迟到不了阈值，但一旦越过上下文窗口（historyWindow 的 200 条
// 安全阀）中段消息就会静默掉出模型视野——所以在逼近窗口前先压缩。
const compactAtMessages = 120

// compactSummaryMaxRunes caps the stored summary so a rambling model can't
// bloat the very context the compaction is supposed to shrink.
const compactSummaryMaxRunes = 2000

// compactTimeout bounds one summarization call.
const compactTimeout = 90 * time.Second

// compactSystemPrompt drives the summarization call.
const compactSystemPrompt = "你是对话上下文压缩器。把给定的对话（可能附带一段既有摘要）压缩成一段中文摘要，" +
	"用于后续对话的背景注入。必须保留：用户的目标与关键需求、已确认的事实与结论、重要偏好与约定、" +
	"未决问题；省略寒暄、重复内容与无关细节。若给出了【既有摘要】，把【新增对话】合并进去，" +
	"输出一段完整的新摘要。直接输出摘要正文，不要任何前缀或解释，长度不超过 500 字。"

// summaryInjectPrefix labels the summary system message sent to the model.
const summaryInjectPrefix = "以下是本会话较早内容的摘要（原文已压缩，视为已发生的对话背景）：\n"

type service struct {
	repo *repo
	// relay is the primary assistant backend: the ScarecrowToken relay's
	// OpenAI-compatible chat completions, routed to a configured text model.
	// nil when no relay API key is set.
	relay *relaychat.Client
	// llmClient is the legacy fallback (Anthropic) used when the relay is not
	// configured or has no text model available. nil when no LLM key is set.
	llmClient *llm.Client
	// fallbackModel is the configured Anthropic model name used by llmClient; it
	// labels the ModelCallLog for fallback conversations. Empty when unset.
	fallbackModel string
	systemPrompt  string
	historyLimit  int
	// ctxTokenLimit caps a conversation's cumulative estimated tokens (see
	// tokens.go); text sends beyond it fail with errContextFull.
	ctxTokenLimit int
	// docSelfHost 是启动时 storage.publicURL 的 host，文档附件解析(docextract)
	// 只允许抓取该 host 或 *.aliyuncs.com 的 URL（SSRF 防护）。
	docSelfHost string
	// live 注册表：会话 → 生成中的回复缓存（断开重连续播，见 live.go）。
	liveMu sync.Mutex
	live   map[idgen.ID]*liveReply
}

func newService(db *gorm.DB, cfg *config.Config) *service {
	s := &service{
		repo:          newRepo(db),
		historyLimit:  cfg.LLM.HistoryLimit,
		systemPrompt:  cfg.LLM.SystemPrompt,
		ctxTokenLimit: cfg.LLM.ContextTokenLimit,
		relay:         relaychat.New(cfg.Relay.BaseURL, cfg.Relay.APIKey),
		live:          map[idgen.ID]*liveReply{},
	}
	if pu, err := url.Parse(cfg.Storage.PublicURL); err == nil {
		s.docSelfHost = pu.Host
	}
	if s.historyLimit <= 0 {
		s.historyLimit = 20
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
			Description: "会话累计上下文 token 估算上限：越过压缩阈值先自动压缩，压缩后仍超限才要求开新会话（保存即生效）",
		}).FirstOrCreate(&seed).Error; err != nil {
		logger.L().Warn("chat: seed context-limit config failed", zap.Error(err))
	}
	var seedCompress model.SysConfig
	if err := db.Where(model.SysConfig{ConfigKey: model.ConfigKeyChatCompressAt}).
		Attrs(model.SysConfig{
			ConfigValue: "0",
			Group:       "AI 对话",
			Description: "会话上下文自动压缩阈值（估算 token）：达到后把较早对话滚动压缩成摘要；0=自动（上限的 70%），保存即生效",
		}).FirstOrCreate(&seedCompress).Error; err != nil {
		logger.L().Warn("chat: seed compress-threshold config failed", zap.Error(err))
	}
	if s.relay != nil {
		logger.L().Info("chat: relay assistant enabled (text models via /v1/chat/completions)")
	}
	if client, err := llm.New(cfg.LLM); err != nil {
		if !errors.Is(err, llm.ErrDisabled) {
			logger.L().Warn("chat: LLM client init failed, using canned replies", zap.Error(err))
		}
	} else {
		s.llmClient = client
		s.fallbackModel = strings.TrimSpace(cfg.LLM.Model)
		logger.L().Info("chat: LLM fallback enabled", zap.String("model", cfg.LLM.Model))
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
	if err := s.repo.createTurn(userMsg, aiMsg); err != nil {
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

// contextTokens sums the estimated tokens of a conversation's EFFECTIVE
// context: the compaction summary plus the text messages it does not cover.
// 已被压缩吞掉的原文不再计数——这正是压缩释放上下文预算的机制。
func (s *service) contextTokens(conv *model.IMConversation) (int, error) {
	rows, err := s.repo.textMessagesAfter(conv.ID, conv.SummaryUptoID)
	if err != nil {
		return 0, err
	}
	used := estimateTokens(conv.ContextSummary)
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
	vo := toContextUsageVO(used, s.contextLimit(), strings.TrimSpace(conv.ContextSummary) != "")
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
// 正常情况下 maybeCompact 会在 70% 阈值先压缩，这里只是最后的兜底。
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

// historyWindow is the max after-summary messages fetched as LLM context. 窗口
// 必须覆盖 contextTokens 计费的全部范围（摘要之后的所有原文），否则会出现
// 「第 N 条起既不在摘要里也不进上下文、却仍占着 token 预算」的静默失忆——
// 消息多而短（或未配置 relay、压缩永不推进）时尤其明显。token 硬上限由
// guardContext 兜底，所以窗口放大不会失控；200 只是 SQL 取数的安全阀。
// 配置的 historyLimit 只在配得更大时生效（旧默认 20 正是失忆的根源）。
func (s *service) historyWindow() int {
	const floor = 200
	if s.historyLimit > floor {
		return s.historyLimit
	}
	return floor
}

// compactThreshold returns the token level that triggers auto-compaction: the
// admin override (sys_config llm.compressAtTokens) when positive, else 70% of
// the context cap. Read per send so admin edits apply without a restart.
func (s *service) compactThreshold() int {
	var row model.SysConfig
	if err := s.repo.db.Where("config_key = ?", model.ConfigKeyChatCompressAt).
		First(&row).Error; err == nil {
		if n, convErr := strconv.Atoi(strings.TrimSpace(row.ConfigValue)); convErr == nil && n > 0 {
			return n
		}
	}
	return s.contextLimit() * 7 / 10
}

// maybeCompact rolls older history into the conversation's summary once the
// estimated context passes the threshold, keeping the most recent
// compactKeepTail messages verbatim. Best-effort：任何失败只记日志并返回
// （fail-open），guardContext 的硬上限仍兜底。成功后就地更新 conv，调用方
// 直接用压缩后的会话继续构建本次回复的上下文。
func (s *service) maybeCompact(ctx context.Context, conv *model.IMConversation) {
	if s.relay == nil {
		return // 压缩本身需要文本模型；无 relay 时维持旧的硬上限行为
	}
	modelKey := s.repo.textModelKey()
	if modelKey == "" {
		return
	}
	rows, err := s.repo.textMessagesAfter(conv.ID, conv.SummaryUptoID)
	if err != nil || len(rows) <= compactKeepTail {
		return
	}
	used := estimateTokens(conv.ContextSummary)
	for i := range rows {
		used += estimateTokens(rows[i].Content)
	}
	// token 或消息条数任一越线都触发压缩（见 compactAtMessages 的注释）。
	if used <= s.compactThreshold() && len(rows) <= compactAtMessages {
		return
	}

	// 压缩对象 = 摘要未覆盖的原文中，除最近 compactKeepTail 条之外的部分；
	// 连同既有摘要一起交给模型输出合并后的新摘要（滚动式，永远只有一段）。
	head := rows[:len(rows)-compactKeepTail]
	var sb strings.Builder
	if prev := strings.TrimSpace(conv.ContextSummary); prev != "" {
		sb.WriteString("【既有摘要】\n")
		sb.WriteString(prev)
		sb.WriteString("\n\n【新增对话】\n")
	}
	for i := range head {
		role := "用户"
		if head[i].SenderID == assistantSenderID {
			role = "助手"
		}
		sb.WriteString(role)
		sb.WriteString("：")
		sb.WriteString(head[i].Content)
		sb.WriteString("\n")
	}

	cctx, cancel := context.WithTimeout(ctx, compactTimeout)
	defer cancel()
	start := time.Now()
	summary, err := s.relay.Chat(cctx, modelKey, []relaychat.Msg{
		relaychat.TextMsg("system", compactSystemPrompt),
		relaychat.TextMsg("user", sb.String()),
	})
	eventlog.ModelText(conv.OwnerID, "compact", modelKey, "/v1/chat/completions",
		sb.String(), summary, start, err)
	if err != nil {
		logger.L().Warn("chat: context compaction failed, keeping full history",
			zap.String("model", modelKey), zap.Error(err))
		return
	}
	summary = strings.TrimSpace(summary)
	if summary == "" {
		return
	}
	if r := []rune(summary); len(r) > compactSummaryMaxRunes {
		summary = string(r[:compactSummaryMaxRunes])
	}
	upto := head[len(head)-1].ID
	if err := s.repo.saveContextSummary(conv.ID, summary, upto); err != nil {
		logger.L().Warn("chat: save compaction summary failed", zap.Error(err))
		return
	}
	conv.ContextSummary = summary
	conv.SummaryUptoID = upto
	logger.L().Info("chat: context compacted",
		zap.String("conversation", conv.ID.String()),
		zap.Int("beforeTokens", used),
		zap.Int("compressedMsgs", len(head)),
		zap.Int("summaryTokens", estimateTokens(summary)))
}

// sendMessage persists the user's message, synchronously generates and persists
// the assistant reply, and returns the user message VO. Ownership is enforced.
// ctx 应传请求上下文：客户端断开即取消压缩与生成，不再用 Background 空烧
// 上游 token（最坏压缩 90s + 生成 60s）。
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
	// 越过阈值先自动压缩（就地更新 conv），压缩后仍超硬上限才拒绝。
	s.maybeCompact(ctx, conv)
	if err := s.guardContext(conv, content); err != nil {
		return nil, err
	}
	imageURLs := imageAttachmentURLs(dto.Attachments)
	docFiles, docNote := s.docFileParts(ctx, dto.Attachments)

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
		return nil, err
	}

	// Generate the assistant reply (real LLM when configured, canned otherwise).
	// A failure to store the reply must not fail the user's send, so it is
	// best-effort. 空回复（请求被取消时 generateReply 返回 ""）不落库——
	// 否则断开的请求会往会话里塞一条空/占位气泡。
	reply := s.generateReply(ctx, conv, ownerID, content, docNote, docFiles, imageURLs, dto.Model)
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

// streamMessage persists the user message, streams the assistant reply token by
// token via onDelta, persists the full assistant reply, and returns the
// assistant message VO. Ownership is enforced. When no relay text model is
// available it emits the canned reply as a single delta so the round-trip still
// completes.
func (s *service) streamMessage(ctx context.Context, conversationID, ownerID idgen.ID, content string, attachments []MessageAttach, requestedModel string, onDelta func(string)) (*MessageVO, error) {
	conv, err := s.repo.findConversation(conversationID)
	if err != nil {
		return nil, err
	}
	if conv.OwnerID != ownerID {
		return nil, errForbidden
	}
	content = strings.TrimSpace(content)
	// 越过阈值先自动压缩（就地更新 conv），压缩后仍超硬上限才拒绝。
	s.maybeCompact(ctx, conv)
	if err := s.guardContext(conv, content); err != nil {
		return nil, err
	}

	// image attachments are forwarded as image_url parts; document attachments
	// are fetched and forwarded as relay "file" parts (docextract.go); every
	// attachment is also snapshotted on the user message for redisplay.
	imageURLs := imageAttachmentURLs(attachments)
	docFiles, docNote := s.docFileParts(ctx, attachments)

	userMsg := &model.IMMessage{
		ConversationID: conversationID,
		SenderID:       ownerID,
		ContentType:    "text",
		Content:        content,
		Params:         attachmentsParams(attachments),
	}
	if err := s.repo.createMessage(userMsg); err != nil {
		return nil, err
	}

	// 注册 live 缓存：增量同时进内存缓存,断开的客户端刷新后可通过
	// GET /stream 重新附着续播（见 live.go）。liveEnd 兜底保证任何返回路径
	// 都会终结订阅者的等待。
	lr := s.liveStart(conversationID)
	defer s.liveEnd(conversationID, lr)
	reply := s.streamReply(ctx, conv, ownerID, content, docNote, docFiles, imageURLs, requestedModel, func(d string) {
		lr.append(d)
		if onDelta != nil {
			onDelta(d)
		}
	})

	aiMsg := &model.IMMessage{
		ConversationID: conversationID,
		SenderID:       assistantSenderID,
		ContentType:    "text",
		Content:        reply,
	}
	at := time.Now()
	// 空回复防御（生成已与客户端断连解耦，正常不会为空）：不落库空气泡。
	if strings.TrimSpace(reply) != "" {
		if err := s.repo.createMessage(aiMsg); err == nil {
			_ = s.repo.touchConversation(conversationID, aiMsg.ID, at)
		} else {
			_ = s.repo.touchConversation(conversationID, userMsg.ID, at)
		}
	} else {
		_ = s.repo.touchConversation(conversationID, userMsg.ID, at)
	}

	vo := toMessageVO(aiMsg, conv.OwnerID)
	lr.finish(&vo)
	return &vo, nil
}

// streamReply streams the assistant reply for the latest user message via the
// relay text model, forwarding each delta through onDelta. On any error (or when
// no relay text model is configured) it falls back to the canned reply, emitted
// as one delta so the client still renders something. 上下文 = system 提示词 +
// 压缩摘要（如有）+ 摘要之后的原文消息。
func (s *service) streamReply(ctx context.Context, conv *model.IMConversation, ownerID idgen.ID, userContent string, docNote string, docFiles []relaychat.FileAttachment, imageURLs []string, requestedModel string, onDelta func(string)) string {
	// 客户端断开不中止生成：前端切页面/切会话都会 abort SSE，请求上下文随之
	// 取消；若生成跟着停，回复只落库半截。分离请求上下文让上游把回复生成完整
	// 并落库，用户切回来能看到全文；llmReplyTimeout 仍然兜底。断开后 onDelta
	// 往已关闭的连接写帧只是静默失败，不影响生成。
	ctx = context.WithoutCancel(ctx)
	conversationID := conv.ID
	if s.relay != nil {
		if model := s.repo.resolveTextModelKey(requestedModel); model != "" {
			if rows, err := s.repo.recentMessages(conversationID, conv.SummaryUptoID, s.historyWindow()); err == nil {
				msgs := make([]relaychat.Msg, 0, len(rows)+2)
				if p := strings.TrimSpace(s.systemPrompt); p != "" {
					msgs = append(msgs, relaychat.TextMsg("system", p))
				}
				if sum := strings.TrimSpace(conv.ContextSummary); sum != "" {
					msgs = append(msgs, relaychat.TextMsg("system", summaryInjectPrefix+sum))
				}
				for i := range rows {
					role := "user"
					if rows[i].SenderID == assistantSenderID {
						role = "assistant"
					}
					msgs = append(msgs, relaychat.TextMsg(role, rows[i].Content))
				}
				// attach the uploaded images (image_url part) and documents (file part)
				// to the latest user message so the model can actually see them —
				// only the current turn carries attachments; 历史行取自落库消息。
				if len(imageURLs) > 0 || len(docFiles) > 0 || docNote != "" {
					combined := userContent
					if docNote != "" {
						combined = strings.TrimSpace(userContent + "\n\n" + docNote)
					}
					for i := len(msgs) - 1; i >= 0; i-- {
						if msgs[i].Role == "user" {
							msgs[i] = relaychat.UserWithAttachments(combined, imageURLs, docFiles)
							break
						}
					}
				}
				cctx, cancel := context.WithTimeout(ctx, llmReplyTimeout)
				defer cancel()
				start := time.Now()
				// 记录已推送给客户端的增量：中途失败时以它为准收尾，绝不再叠加
				// 降级回复——否则客户端看到「半截真回复 + 占位文案」，而落库的又是
				// 另一份内容，三方不一致。
				var streamed strings.Builder
				reply, err := s.relay.ChatStream(cctx, model, msgs, func(d string) {
					streamed.WriteString(d)
					if onDelta != nil {
						onDelta(d)
					}
				})
				reqBody, _ := json.Marshal(msgs)
				eventlog.ModelText(ownerID, "chat", model, "/v1/chat/completions", string(reqBody), reply, start, err)
				if err == nil {
					return reply
				}
				logger.L().Warn("chat: relay stream failed", zap.String("model", model), zap.Error(err))
				if partial := strings.TrimSpace(streamed.String()); partial != "" {
					// 已流出实质内容（如上游超时/中途出错）：持久化已生成的部分，跳过降级链。
					return streamed.String()
				}
			}
		}
	}

	// Fallback: legacy Anthropic client. It cannot stream, so the full reply is
	// emitted as a single delta. Audit/cost tracking must still record the call.
	// （压缩摘要不注入此路径：Turn 只有 user/assistant 两种角色且要求交替，
	// 强插伪造轮次弊大于利——legacy 回退本就是降级体验。）
	if s.llmClient != nil {
		if rows, err := s.repo.recentMessages(conversationID, conv.SummaryUptoID, s.historyWindow()); err == nil {
			turns := make([]llm.Turn, 0, len(rows))
			for i := range rows {
				role := llm.RoleUser
				if rows[i].SenderID == assistantSenderID {
					role = llm.RoleAssistant
				}
				turns = append(turns, llm.Turn{Role: role, Text: rows[i].Content})
			}
			cctx, cancel := context.WithTimeout(ctx, llmReplyTimeout)
			defer cancel()
			start := time.Now()
			reply, cerr := s.llmClient.Chat(cctx, turns)
			reqBody, _ := json.Marshal(turns)
			eventlog.ModelText(ownerID, "chat", s.fallbackModelID(), "anthropic", string(reqBody), reply, start, cerr)
			if cerr == nil {
				if onDelta != nil {
					onDelta(reply)
				}
				return reply
			}
			logger.L().Warn("chat: LLM stream fallback failed, using canned reply", zap.Error(cerr))
		}
	}

	reply := s.buildReply(userContent)
	if onDelta != nil {
		onDelta(reply)
	}
	return reply
}

// imageAttachmentURLs returns the hosted URLs of the image attachments (the only
// kind forwarded to the model as multimodal content).
func imageAttachmentURLs(atts []MessageAttach) []string {
	urls := make([]string, 0, len(atts))
	for _, a := range atts {
		kind := strings.TrimSpace(a.Kind)
		u := strings.TrimSpace(a.URL)
		// only absolute URLs are fetchable by the upstream model; skip relative paths.
		if (kind == "" || kind == "image") && (strings.HasPrefix(u, "http://") || strings.HasPrefix(u, "https://") || strings.HasPrefix(u, "data:")) {
			urls = append(urls, u)
		}
	}
	return urls
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

// fallbackModelID labels the ModelCallLog for the Anthropic fallback path. It
// uses the configured fallback model name when known, else a stable sentinel.
func (s *service) fallbackModelID() string {
	if s.fallbackModel != "" {
		return s.fallbackModel
	}
	return "anthropic-fallback"
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


// generateReply produces the assistant reply for the latest user message. When
// an LLM is configured it sends the recent transcript to the model; on any error
// (or when no LLM is configured) it falls back to the canned placeholder so the
// chat round-trip always completes. 上下文 = system 提示词 + 压缩摘要（如有）+
// 摘要之后的原文消息。
func (s *service) generateReply(ctx context.Context, conv *model.IMConversation, ownerID idgen.ID, userContent string, docNote string, docFiles []relaychat.FileAttachment, imageURLs []string, requestedModel string) string {
	if s.relay == nil && s.llmClient == nil {
		return s.buildReply(userContent)
	}

	rows, err := s.repo.recentMessages(conv.ID, conv.SummaryUptoID, s.historyWindow())
	if err != nil {
		logger.L().Warn("chat: load context failed, using canned reply", zap.Error(err))
		return s.buildReply(userContent)
	}

	// 1) Preferred: relay chat completions, routed to a configured text model.
	if s.relay != nil {
		if model := s.repo.resolveTextModelKey(requestedModel); model != "" {
			msgs := make([]relaychat.Msg, 0, len(rows)+2)
			if p := strings.TrimSpace(s.systemPrompt); p != "" {
				msgs = append(msgs, relaychat.TextMsg("system", p))
			}
			if sum := strings.TrimSpace(conv.ContextSummary); sum != "" {
				msgs = append(msgs, relaychat.TextMsg("system", summaryInjectPrefix+sum))
			}
			for i := range rows {
				role := "user"
				if rows[i].SenderID == assistantSenderID {
					role = "assistant"
				}
				msgs = append(msgs, relaychat.TextMsg(role, rows[i].Content))
			}
			// attach the uploaded images (image_url) / documents (file part) to the
			// latest user message.
			if len(imageURLs) > 0 || len(docFiles) > 0 || docNote != "" {
				combined := userContent
				if docNote != "" {
					combined = strings.TrimSpace(userContent + "\n\n" + docNote)
				}
				for i := len(msgs) - 1; i >= 0; i-- {
					if msgs[i].Role == "user" {
						msgs[i] = relaychat.UserWithAttachments(combined, imageURLs, docFiles)
						break
					}
				}
			}
			cctx, cancel := context.WithTimeout(ctx, llmReplyTimeout)
			defer cancel()
			start := time.Now()
			reply, err := s.relay.Chat(cctx, model, msgs)
			reqBody, _ := json.Marshal(msgs)
			eventlog.ModelText(ownerID, "chat", model, "/v1/chat/completions", string(reqBody), reply, start, err)
			if err == nil {
				return reply
			}
			logger.L().Warn("chat: relay generation failed, falling back", zap.String("model", model), zap.Error(err))
			if ctx.Err() != nil {
				return "" // 请求已取消（客户端断开）：不再降级空烧，也不落库占位
			}
		}
	}

	// 2) Fallback: legacy Anthropic client.
	if s.llmClient != nil {
		turns := make([]llm.Turn, 0, len(rows))
		for i := range rows {
			role := llm.RoleUser
			if rows[i].SenderID == assistantSenderID {
				role = llm.RoleAssistant
			}
			turns = append(turns, llm.Turn{Role: role, Text: rows[i].Content})
		}
		cctx, cancel := context.WithTimeout(ctx, llmReplyTimeout)
		defer cancel()
		start := time.Now()
		reply, err := s.llmClient.Chat(cctx, turns)
		reqBody, _ := json.Marshal(turns)
		eventlog.ModelText(ownerID, "chat", s.fallbackModelID(), "anthropic", string(reqBody), reply, start, err)
		if err == nil {
			return reply
		}
		logger.L().Warn("chat: LLM generation failed, using canned reply", zap.Error(err))
		if ctx.Err() != nil {
			return ""
		}
	}

	// 3) Canned placeholder.
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
