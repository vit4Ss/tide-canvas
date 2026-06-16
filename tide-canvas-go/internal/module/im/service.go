package im

import (
	"encoding/json"
	"time"

	"gorm.io/datatypes"
	"gorm.io/gorm"

	"github.com/sirupsen/logrus"

	"github.com/tidecanvas/tide-canvas-go/internal/model"
	"github.com/tidecanvas/tide-canvas-go/pkg/ecode"
)

// Service IM 业务逻辑：会话(私信/客服/后台) + 消息收发推送 + 在线状态。
type Service struct {
	repo   *Repository
	hub    *Hub
	users  UserFinder
	logger *logrus.Logger
}

// 编译期断言：Service 实现 WS 上行处理器。
var _ InboundHandler = (*Service)(nil)

// NewService 构造。hub 通过 SetHub 注入（解决 hub↔service 循环依赖）。
func NewService(repo *Repository, users UserFinder, logger *logrus.Logger) *Service {
	return &Service{repo: repo, users: users, logger: logger}
}

// SetHub 注入连接中心（在 NewHub 之后调用）。
func (s *Service) SetHub(h *Hub) { s.hub = h }

// ---------- 会话：三种场景 ----------

// OpenPrivate 打开/创建与某用户的私信会话（1v1，自动去重）。
func (s *Service) OpenPrivate(userID int64, req *OpenPrivateReq) (*ConversationVO, error) {
	peerID, err := s.users.ResolveID(req.PeerID)
	if err != nil {
		return nil, ecode.NotFound.WithMessage("对方用户不存在")
	}
	if peerID == userID {
		return nil, ecode.BadRequest.WithMessage("不能与自己私信")
	}
	conv, err := s.repo.FindPrivateBetween(userID, peerID)
	if err != nil {
		return nil, err
	}
	if conv == nil {
		conv = &model.ImConversation{Type: model.ConvTypePrivate, OwnerID: &userID, MemberCount: 2}
		if err := s.repo.DB().Transaction(func(tx *gorm.DB) error {
			if e := s.repo.CreateConversation(tx, conv); e != nil {
				return e
			}
			if e := s.repo.CreateMember(tx, &model.ImConversationMember{ConversationID: conv.ID, UserID: userID, Role: model.MemberRoleOwner}); e != nil {
				return e
			}
			return s.repo.CreateMember(tx, &model.ImConversationMember{ConversationID: conv.ID, UserID: peerID, Role: model.MemberRoleNormal})
		}); err != nil {
			return nil, err
		}
	}
	return s.toConversationVO(conv, userID)
}

// OpenSupport 用户发起客服会话（状态=待接入，等在线客服接入）。
func (s *Service) OpenSupport(userID int64) (*ConversationVO, error) {
	conv := &model.ImConversation{
		Type: model.ConvTypeSupport, OwnerID: &userID,
		Status: model.SupportStatusWaiting, MemberCount: 1, Title: "客服咨询",
	}
	if err := s.repo.DB().Transaction(func(tx *gorm.DB) error {
		if e := s.repo.CreateConversation(tx, conv); e != nil {
			return e
		}
		return s.repo.CreateMember(tx, &model.ImConversationMember{ConversationID: conv.ID, UserID: userID, Role: model.MemberRoleOwner})
	}); err != nil {
		return nil, err
	}
	return s.toConversationVO(conv, userID)
}

// ListWaitingSupport 客服端：待接入会话列表（先到先接）。调用方须确保是客服/管理员。
func (s *Service) ListWaitingSupport(q *PageQuery) ([]ConversationVO, int64, error) {
	q.Normalize()
	rows, total, err := s.repo.ListWaitingSupport(q.PageNum, q.PageSize)
	if err != nil {
		return nil, 0, err
	}
	vos, err := s.buildConversationVOList(rows, 0)
	return vos, total, err
}

// AcceptSupport 客服接入待处理会话（原子抢占 + 加客服为成员 + 系统消息）。
func (s *Service) AcceptSupport(agentID int64, convPublicID string) (*ConversationVO, error) {
	conv, err := s.repo.FindByPublicID(convPublicID)
	if err != nil {
		return nil, err
	}
	if conv == nil || conv.Type != model.ConvTypeSupport {
		return nil, ecode.NotFound.WithMessage("客服会话不存在")
	}
	ok, err := s.repo.AssignSupport(conv.ID, agentID)
	if err != nil {
		return nil, err
	}
	if !ok {
		return nil, ecode.BadRequest.WithMessage("会话已被接入或已结束")
	}
	existing, err := s.repo.FindMember(conv.ID, agentID)
	if err != nil {
		return nil, err
	}
	if existing == nil {
		if err := s.repo.DB().Transaction(func(tx *gorm.DB) error {
			if e := s.repo.CreateMember(tx, &model.ImConversationMember{ConversationID: conv.ID, UserID: agentID, Role: model.MemberRoleAgent}); e != nil {
				return e
			}
			return s.repo.IncrMemberCount(tx, conv.ID, 1)
		}); err != nil {
			return nil, err
		}
	}
	conv.AssigneeID = &agentID
	conv.Status = model.SupportStatusActive
	s.sendSystem(conv, "客服已接入，开始为您服务")
	return s.toConversationVO(conv, agentID)
}

// OpenStaff 后台使用者发起会话（1 个成员=1v1，多个=群聊）。调用方须确保是后台用户。
func (s *Service) OpenStaff(userID int64, req *OpenStaffReq) (*ConversationVO, error) {
	memberIDs, err := s.users.ResolveIDs(req.MemberIDs)
	if err != nil {
		return nil, err
	}
	set := map[int64]bool{userID: true}
	for _, id := range memberIDs {
		set[id] = true
	}
	ids := keys(set)
	conv := &model.ImConversation{Type: model.ConvTypeStaff, OwnerID: &userID, MemberCount: len(ids), Title: req.Title}
	if err := s.repo.DB().Transaction(func(tx *gorm.DB) error {
		if e := s.repo.CreateConversation(tx, conv); e != nil {
			return e
		}
		for _, id := range ids {
			role := model.MemberRoleNormal
			if id == userID {
				role = model.MemberRoleOwner
			}
			if e := s.repo.CreateMember(tx, &model.ImConversationMember{ConversationID: conv.ID, UserID: id, Role: role}); e != nil {
				return e
			}
		}
		return nil
	}); err != nil {
		return nil, err
	}
	return s.toConversationVO(conv, userID)
}

// ---------- 消息 ----------

// SendMessage 发送消息：持久化(事务) + 更新会话冗余 + 未读累计，提交后推送在线成员。
func (s *Service) SendMessage(senderID int64, req *SendMessageReq) (*MessageVO, error) {
	conv, err := s.repo.FindByPublicID(req.ConversationID)
	if err != nil {
		return nil, err
	}
	if conv == nil {
		return nil, ecode.NotFound.WithMessage("会话不存在")
	}
	member, err := s.repo.FindMember(conv.ID, senderID)
	if err != nil {
		return nil, err
	}
	if member == nil || member.Removed == 1 {
		return nil, ecode.Forbidden.WithMessage("非会话成员")
	}

	ctype := req.ContentType
	if ctype == "" {
		ctype = model.MsgTypeText
	}
	var extra datatypes.JSON
	if req.Extra != nil {
		if b, e := json.Marshal(req.Extra); e == nil {
			extra = b
		}
	}
	msg := &model.ImMessage{
		ConversationID: conv.ID,
		SenderID:       &senderID,
		ContentType:    ctype,
		Content:        req.Content,
		Extra:          extra,
		Status:         model.MsgStatusNormal,
	}
	if err := s.repo.DB().Transaction(func(tx *gorm.DB) error {
		if e := s.repo.CreateMessage(tx, msg); e != nil {
			return e
		}
		if e := s.repo.UpdateLastMessage(tx, conv.ID, msg.ID, summarize(ctype, req.Content), msg.CreateTime); e != nil {
			return e
		}
		return s.repo.IncrUnreadExcept(tx, conv.ID, senderID)
	}); err != nil {
		return nil, err
	}

	sids := senderIDsOf(msg)
	briefs, _ := s.users.Brief(sids)
	online := s.hub.OnlineFilter(sids)
	vo := s.buildMessageVO(msg, conv.PublicID, briefs, online)
	s.broadcast(conv, WSEvent{Type: EventMessage, ConversationID: conv.PublicID, Message: &vo})
	return &vo, nil
}

// ListMessages 会话历史（游标分页，按时间正序返回）。
func (s *Service) ListMessages(userID int64, convPublicID, beforePublicID string, limit int) ([]MessageVO, error) {
	conv, err := s.repo.FindByPublicID(convPublicID)
	if err != nil {
		return nil, err
	}
	if conv == nil {
		return nil, ecode.NotFound.WithMessage("会话不存在")
	}
	member, err := s.repo.FindMember(conv.ID, userID)
	if err != nil {
		return nil, err
	}
	if member == nil || member.Removed == 1 {
		return nil, ecode.Forbidden.WithMessage("非会话成员")
	}
	if limit <= 0 || limit > 100 {
		limit = 30
	}
	var beforeID int64
	if beforePublicID != "" {
		if m, e := s.repo.FindMessageByPublicID(beforePublicID); e == nil && m != nil {
			beforeID = m.ID
		}
	}
	rows, err := s.repo.ListMessages(conv.ID, beforeID, limit)
	if err != nil {
		return nil, err
	}
	senderIDs := uniqueSenders(rows)
	briefs, _ := s.users.Brief(senderIDs)
	online := s.hub.OnlineFilter(senderIDs)
	vos := make([]MessageVO, 0, len(rows))
	for i := len(rows) - 1; i >= 0; i-- { // DESC → 正序
		vos = append(vos, s.buildMessageVO(&rows[i], conv.PublicID, briefs, online))
	}
	return vos, nil
}

// MarkRead 标记会话已读（清零未读 + 推送已读回执）。
func (s *Service) MarkRead(userID int64, req *MarkReadReq) error {
	conv, err := s.repo.FindByPublicID(req.ConversationID)
	if err != nil {
		return err
	}
	if conv == nil {
		return ecode.NotFound.WithMessage("会话不存在")
	}
	member, err := s.repo.FindMember(conv.ID, userID)
	if err != nil {
		return err
	}
	if member == nil {
		return ecode.Forbidden.WithMessage("非会话成员")
	}
	var lastID int64
	if conv.LastMessageID != nil {
		lastID = *conv.LastMessageID
	}
	if req.LastReadID != "" {
		if m, e := s.repo.FindMessageByPublicID(req.LastReadID); e == nil && m != nil {
			lastID = m.ID
		}
	}
	if err := s.repo.ResetUnread(conv.ID, userID, lastID); err != nil {
		return err
	}
	pubID := s.publicIDOf(userID)
	s.broadcast(conv, WSEvent{Type: EventRead, ConversationID: conv.PublicID, UserID: pubID})
	return nil
}

// Recall 撤回消息（仅发送者本人）。
func (s *Service) Recall(userID int64, msgPublicID string) error {
	msg, err := s.repo.FindMessageByPublicID(msgPublicID)
	if err != nil {
		return err
	}
	if msg == nil {
		return ecode.NotFound.WithMessage("消息不存在")
	}
	if msg.SenderID == nil || *msg.SenderID != userID {
		return ecode.Forbidden.WithMessage("只能撤回自己的消息")
	}
	if err := s.repo.RecallMessage(msg.ID); err != nil {
		return err
	}
	conv, _ := s.repo.FindByID(msg.ConversationID)
	if conv != nil {
		msg.Status = model.MsgStatusRecalled
		vo := s.buildMessageVO(msg, conv.PublicID, nil, nil)
		s.broadcast(conv, WSEvent{Type: EventMessage, ConversationID: conv.PublicID, Message: &vo})
	}
	return nil
}

// ---------- 会话列表 / 在线状态 ----------

// ListConversations 当前用户的会话列表（按最后消息时间倒序，含未读/对端在线）。
func (s *Service) ListConversations(userID int64, convType string, q *PageQuery) ([]ConversationVO, int64, error) {
	q.Normalize()
	items, total, err := s.repo.ListConversationsOfUser(userID, convType, q.PageNum, q.PageSize)
	if err != nil {
		return nil, 0, err
	}
	convIDs := make([]int64, 0, len(items))
	for i := range items {
		convIDs = append(convIDs, items[i].ID)
	}
	membersByConv, allUserIDs := s.membersByConversations(convIDs)
	briefs, _ := s.users.Brief(allUserIDs)
	online := s.hub.OnlineFilter(allUserIDs)
	vos := make([]ConversationVO, 0, len(items))
	for i := range items {
		vos = append(vos, s.buildConversationVO(&items[i].ImConversation, items[i].Unread, membersByConv[items[i].ID], userID, briefs, online))
	}
	return vos, total, nil
}

// GetUserStatus 批量查询用户在线状态（实时在线以 WS 连接为准，附最后在线时间）。
func (s *Service) GetUserStatus(userPublicIDs []string) ([]UserStatusVO, error) {
	ids, err := s.users.ResolveIDs(userPublicIDs)
	if err != nil {
		return nil, err
	}
	briefs, _ := s.users.Brief(ids)
	statuses, _ := s.repo.ListStatus(ids)
	online := s.hub.OnlineFilter(ids)
	out := make([]UserStatusVO, 0, len(ids))
	for _, id := range ids {
		vo := UserStatusVO{ID: briefs[id].PublicID, Online: online[id]}
		if st, ok := statuses[id]; ok {
			vo.LastSeen = st.LastSeenTime
		}
		out = append(out, vo)
	}
	return out, nil
}

// ---------- WS 上行 / 在线状态回调 ----------

// HandleInbound 处理客户端经 WS 上行的消息（发消息 / 标记已读）。
func (s *Service) HandleInbound(userID int64, raw []byte) {
	var in InboundMsg
	if err := json.Unmarshal(raw, &in); err != nil {
		return
	}
	switch in.Type {
	case InboundSend:
		if _, err := s.SendMessage(userID, &SendMessageReq{
			ConversationID: in.ConversationID, ContentType: in.ContentType, Content: in.Content,
		}); err != nil {
			s.logWarn("ws inbound send: %v", err)
		}
	case InboundRead:
		if err := s.MarkRead(userID, &MarkReadReq{ConversationID: in.ConversationID, LastReadID: in.LastReadID}); err != nil {
			s.logWarn("ws inbound read: %v", err)
		}
	}
}

// OnUserOnline 用户上线回调（落库 + 向其会话对端广播上线）。供 NewHub 注入。
func (s *Service) OnUserOnline(userID int64) {
	now := time.Now()
	if err := s.repo.UpsertStatus(userID, true, &now); err != nil {
		s.logWarn("upsert online: %v", err)
	}
	s.broadcastPresence(userID, EventOnline)
}

// OnUserOffline 用户下线回调（落库 last_seen + 广播下线）。供 NewHub 注入。
func (s *Service) OnUserOffline(userID int64) {
	now := time.Now()
	if err := s.repo.UpsertStatus(userID, false, &now); err != nil {
		s.logWarn("upsert offline: %v", err)
	}
	s.broadcastPresence(userID, EventOffline)
}

// ---------- 内部辅助 ----------

func (s *Service) sendSystem(conv *model.ImConversation, text string) {
	msg := &model.ImMessage{ConversationID: conv.ID, ContentType: model.MsgTypeSystem, Content: text, Status: model.MsgStatusNormal}
	if err := s.repo.DB().Transaction(func(tx *gorm.DB) error {
		if e := s.repo.CreateMessage(tx, msg); e != nil {
			return e
		}
		return s.repo.UpdateLastMessage(tx, conv.ID, msg.ID, text, msg.CreateTime)
	}); err != nil {
		s.logWarn("send system msg: %v", err)
		return
	}
	vo := s.buildMessageVO(msg, conv.PublicID, nil, nil)
	s.broadcast(conv, WSEvent{Type: EventMessage, ConversationID: conv.PublicID, Message: &vo})
}

// broadcast 向会话所有有效成员推送事件。
func (s *Service) broadcast(conv *model.ImConversation, event WSEvent) {
	ids, err := s.repo.ListMemberUserIDs(conv.ID)
	if err != nil {
		return
	}
	if payload := s.marshal(event); payload != nil {
		s.hub.SendToUsers(ids, payload)
	}
}

// broadcastPresence 向该用户所有会话的对端广播上线/下线。
func (s *Service) broadcastPresence(userID int64, eventType string) {
	peers, err := s.listPeerUserIDs(userID)
	if err != nil || len(peers) == 0 {
		return
	}
	if payload := s.marshal(WSEvent{Type: eventType, UserID: s.publicIDOf(userID)}); payload != nil {
		s.hub.SendToUsers(peers, payload)
	}
}

// listPeerUserIDs 查该用户所有会话的其他成员（去重）。
func (s *Service) listPeerUserIDs(userID int64) ([]int64, error) {
	var ids []int64
	err := s.repo.DB().
		Table("im_conversation_member AS m1").
		Select("DISTINCT m2.user_id").
		Joins("JOIN im_conversation_member m2 ON m2.conversation_id = m1.conversation_id AND m2.user_id <> m1.user_id AND m2.removed = 0").
		Where("m1.user_id = ? AND m1.removed = 0", userID).
		Scan(&ids).Error
	return ids, err
}

// membersByConversations 批量查会话成员，返回 (convID→[]userID, 全部userID去重)。
func (s *Service) membersByConversations(convIDs []int64) (map[int64][]int64, []int64) {
	result := make(map[int64][]int64)
	if len(convIDs) == 0 {
		return result, nil
	}
	type row struct {
		ConversationID int64
		UserID         int64
	}
	var rows []row
	_ = s.repo.DB().Table("im_conversation_member").Select("conversation_id, user_id").
		Where("conversation_id IN ? AND removed = 0", convIDs).Scan(&rows).Error
	allSet := make(map[int64]bool)
	for _, r := range rows {
		result[r.ConversationID] = append(result[r.ConversationID], r.UserID)
		allSet[r.UserID] = true
	}
	return result, keys(allSet)
}

func (s *Service) buildConversationVOList(rows []model.ImConversation, selfID int64) ([]ConversationVO, error) {
	convIDs := make([]int64, 0, len(rows))
	for i := range rows {
		convIDs = append(convIDs, rows[i].ID)
	}
	membersByConv, allUserIDs := s.membersByConversations(convIDs)
	briefs, _ := s.users.Brief(allUserIDs)
	online := s.hub.OnlineFilter(allUserIDs)
	vos := make([]ConversationVO, 0, len(rows))
	for i := range rows {
		vos = append(vos, s.buildConversationVO(&rows[i], 0, membersByConv[rows[i].ID], selfID, briefs, online))
	}
	return vos, nil
}

func (s *Service) toConversationVO(conv *model.ImConversation, userID int64) (*ConversationVO, error) {
	memberIDs, err := s.repo.ListMemberUserIDs(conv.ID)
	if err != nil {
		return nil, err
	}
	briefs, _ := s.users.Brief(memberIDs)
	online := s.hub.OnlineFilter(memberIDs)
	unread := 0
	if m, e := s.repo.FindMember(conv.ID, userID); e == nil && m != nil {
		unread = m.UnreadCount
	}
	vo := s.buildConversationVO(conv, unread, memberIDs, userID, briefs, online)
	return &vo, nil
}

func (s *Service) buildConversationVO(conv *model.ImConversation, unread int, memberIDs []int64, selfID int64, briefs map[int64]UserBrief, online map[int64]bool) ConversationVO {
	vo := ConversationVO{
		ID: conv.PublicID, Type: conv.Type, Title: conv.Title, Status: conv.Status,
		Unread: unread, LastMessageText: conv.LastMessageText, LastMessageTime: conv.LastMessageTime, UpdateTime: conv.UpdateTime,
	}
	others := make([]UserBriefVO, 0, len(memberIDs))
	for _, id := range memberIDs {
		if id == selfID {
			continue
		}
		b := briefs[id]
		others = append(others, UserBriefVO{ID: b.PublicID, Nickname: b.Nickname, Avatar: b.Avatar, Online: online[id]})
	}
	if conv.Type == model.ConvTypeStaff {
		vo.Members = others
	} else if len(others) > 0 {
		vo.Peer = &others[0]
	}
	return vo
}

func (s *Service) buildMessageVO(m *model.ImMessage, convPublicID string, briefs map[int64]UserBrief, online map[int64]bool) MessageVO {
	vo := MessageVO{
		ID: m.PublicID, ConversationID: convPublicID, ContentType: m.ContentType,
		Content: m.Content, Status: m.Status, CreateTime: m.CreateTime,
	}
	if m.Status == model.MsgStatusRecalled {
		vo.Content = "" // 撤回后不回传原文
	} else if len(m.Extra) > 0 {
		var e interface{}
		if json.Unmarshal(m.Extra, &e) == nil {
			vo.Extra = e
		}
	}
	if m.SenderID != nil {
		b := briefs[*m.SenderID]
		vo.Sender = &UserBriefVO{ID: b.PublicID, Nickname: b.Nickname, Avatar: b.Avatar, Online: online[*m.SenderID]}
	}
	return vo
}

func (s *Service) publicIDOf(userID int64) string {
	briefs, _ := s.users.Brief([]int64{userID})
	return briefs[userID].PublicID
}

func (s *Service) marshal(v interface{}) []byte {
	b, err := json.Marshal(v)
	if err != nil {
		s.logWarn("marshal ws event: %v", err)
		return nil
	}
	return b
}

func (s *Service) logWarn(format string, args ...interface{}) {
	if s.logger != nil {
		s.logger.Warnf(format, args...)
	}
}

func keys(set map[int64]bool) []int64 {
	out := make([]int64, 0, len(set))
	for k := range set {
		out = append(out, k)
	}
	return out
}

func senderIDsOf(m *model.ImMessage) []int64 {
	if m.SenderID != nil {
		return []int64{*m.SenderID}
	}
	return nil
}

func uniqueSenders(rows []model.ImMessage) []int64 {
	set := make(map[int64]bool)
	for i := range rows {
		if rows[i].SenderID != nil {
			set[*rows[i].SenderID] = true
		}
	}
	return keys(set)
}

func summarize(contentType, content string) string {
	switch contentType {
	case model.MsgTypeImage:
		return "[图片]"
	case model.MsgTypeFile:
		return "[文件]"
	}
	r := []rune(content)
	if len(r) > 200 {
		return string(r[:200])
	}
	return content
}
