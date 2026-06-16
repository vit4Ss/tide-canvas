package notification

import (
	"github.com/sirupsen/logrus"

	"github.com/tidecanvas/tide-canvas-go/internal/model"
)

// Service 通知业务逻辑。
//
// 既对外提供查询能力（列表 / 未读数 / 标记已读），又作为 Notifier 供 follow / community / blog
// 等模块在动作成功后投递通知。投递入口 CreateNotification 自带「actor==receiver 跳过」(不给自己发)，
// 实际落库异步进行（见各业务模块的 go + recover 包裹，失败不影响主流程）。
type Service struct {
	repo    *Repository
	users   UserFinder
	targets TargetFinder
	pusher  Pusher // 可选：新通知落库后经 WS 推送角标信封；nil 表示未接入实时推送（nil 安全）。
	logger  *logrus.Logger
}

// NewService 构造通知服务。
// users / targets 为跨模块只读依赖（见 deps.go）：由 router.New 注入 DBUserFinder / DBTargetFinder。
// logger 可为 nil。
func NewService(repo *Repository, users UserFinder, targets TargetFinder, logger *logrus.Logger) *Service {
	return &Service{repo: repo, users: users, targets: targets, logger: logger}
}

// SetPusher 注入 WebSocket 实时推送（可选，nil 安全）。
// 由 router.New 在 im.Hub 就绪后回填（hub 构造晚于 notification.Service，故走 setter 而非构造参数）。
// 注入后，CreateNotification 落库成功会向接收者推 {"type":"notification"} 信封触发前端角标 +1。
func (s *Service) SetPusher(p Pusher) { s.pusher = p }

// wsNotificationEnvelope 通知实时推送信封：仅 type=notification 触发前端拉取/角标 +1，
// 不携带通知正文（前端打开面板时另行 REST 拉全量列表）。对齐前端 WSEvent.type。
var wsNotificationEnvelope = []byte(`{"type":"notification"}`)

// CreateNotification 投递一条通知（Notifier 接口实现）。
//
//   - actorID == receiverID 直接跳过（不给自己发通知）。
//   - 同步落库；调用方应在 goroutine + recover 中调用（参考 log.RecordOperation），
//     使通知失败不影响触发动作的主流程。
//
// 参数：receiverID 收通知者内部ID，actorID 触发者内部ID，typ 类型(follow/comment/like)，
// targetType 目标类型(post/blog/空)，targetID 目标内容内部主键(0=无)，content 摘要文案。
func (s *Service) CreateNotification(receiverID, actorID int64, typ, targetType string, targetID int64, content string) error {
	if actorID == receiverID {
		return nil
	}
	n := &model.SysNotification{
		ReceiverID: receiverID,
		ActorID:    actorID,
		Type:       typ,
		TargetType: targetType,
		TargetID:   targetID,
		Content:    content,
		IsRead:     0,
	}
	if err := s.repo.Create(n); err != nil {
		s.logWarnf("写入通知失败: receiver=%d actor=%d type=%s: %v", receiverID, actorID, typ, err)
		return err
	}
	// 落库成功 → WS 推一条角标信封给接收者（仅触发前端 +1，不带正文）。
	// pusher 为 nil 或推送出错均不影响通知主流程；CreateNotification 已在调用方 goroutine 内，无需再起 go。
	s.pushBadge(receiverID)
	return nil
}

// pushBadge 向接收者推送通知角标信封（{"type":"notification"}）。
// pusher 未注入(nil)直接返回；推送为非阻塞尽力而为，失败仅依赖底层日志，不向上传播。
func (s *Service) pushBadge(receiverID int64) {
	if s.pusher == nil {
		return
	}
	defer func() {
		if r := recover(); r != nil {
			s.logWarnf("推送通知角标 panic: receiver=%d: %v", receiverID, r)
		}
	}()
	s.pusher.SendToUser(receiverID, wsNotificationEnvelope)
}

// pageData 服务层分页载荷，由 handler 转交 response.Page 输出。
type pageData struct {
	Records  []NotificationVO
	Total    int64
	PageNum  int
	PageSize int
}

// List 通知列表（分页，可按类型过滤）：批量解析 actor 用户摘要与 target 内容 public_id，避免 N+1。
func (s *Service) List(receiverID int64, query *NotificationQuery) (*pageData, error) {
	query.normalize()
	rows, total, err := s.repo.PageByReceiver(receiverID, query.Type, query.PageNum, query.PageSize)
	if err != nil {
		return nil, err
	}
	vos, err := s.buildVOs(receiverID, rows)
	if err != nil {
		return nil, err
	}
	return &pageData{Records: vos, Total: total, PageNum: query.PageNum, PageSize: query.PageSize}, nil
}

// CountUnread 未读通知数。
func (s *Service) CountUnread(receiverID int64) (int64, error) {
	return s.repo.CountUnread(receiverID)
}

// MarkRead 标记指定通知为已读（仅本人名下）。
func (s *Service) MarkRead(receiverID int64, ids []int64) error {
	return s.repo.MarkRead(receiverID, ids)
}

// MarkAllRead 标记全部为已读。
func (s *Service) MarkAllRead(receiverID int64) error {
	return s.repo.MarkAllRead(receiverID)
}

// buildVOs 把通知行批量转为 VO：批量取 actor 用户摘要、批量按目标类型反解 target public_id，
// 并对关注类(follow)通知批量标注 followedByMe（当前用户 receiverID 是否已回关该 actor）。
func (s *Service) buildVOs(receiverID int64, rows []model.SysNotification) ([]NotificationVO, error) {
	out := make([]NotificationVO, 0, len(rows))
	if len(rows) == 0 {
		return out, nil
	}

	// 收集 actor 内部ID、按目标类型分别收集 target 内部ID、单独收集关注类通知的 actor 内部ID（用于回关判定）。
	actorIDs := make([]int64, 0, len(rows))
	postIDs := make([]int64, 0)
	blogIDs := make([]int64, 0)
	followActorIDs := make([]int64, 0)
	for i := range rows {
		actorIDs = append(actorIDs, rows[i].ActorID)
		switch rows[i].TargetType {
		case model.NotificationTargetPost:
			if rows[i].TargetID > 0 {
				postIDs = append(postIDs, rows[i].TargetID)
			}
		case model.NotificationTargetBlog:
			if rows[i].TargetID > 0 {
				blogIDs = append(blogIDs, rows[i].TargetID)
			}
		}
		if rows[i].Type == model.NotificationTypeFollow {
			followActorIDs = append(followActorIDs, rows[i].ActorID)
		}
	}

	users, err := s.users.FindUsers(actorIDs)
	if err != nil {
		return nil, err
	}
	postPublic, err := s.targets.PostPublicIDs(postIDs)
	if err != nil {
		return nil, err
	}
	blogPublic, err := s.targets.BlogPublicIDs(blogIDs)
	if err != nil {
		return nil, err
	}
	// 当前用户已回关的 actor 集合（仅关注类通知需要；followActorIDs 为空时返回空集，无额外查询开销）。
	followedSet, err := s.repo.FollowedSet(receiverID, followActorIDs)
	if err != nil {
		return nil, err
	}

	for i := range rows {
		n := &rows[i]
		vo := NotificationVO{
			ID:         n.ID,
			Type:       n.Type,
			TargetType: n.TargetType,
			Content:    n.Content,
			IsRead:     n.IsRead == 1,
			CreateTime: n.CreateTime,
		}
		if u, ok := users[n.ActorID]; ok {
			vo.Actor = ActorVO{
				ID:       u.PublicID,
				Username: u.Username,
				Nickname: u.Nickname,
				Avatar:   u.Avatar,
			}
		}
		// 把内部 target_id 反解为对应内容的 public_id（转不到则留空串）。
		switch n.TargetType {
		case model.NotificationTargetPost:
			vo.TargetPublicID = postPublic[n.TargetID]
		case model.NotificationTargetBlog:
			vo.TargetPublicID = blogPublic[n.TargetID]
		}
		// 关注类通知：标注当前用户是否已回关该 actor（非关注类恒 false）。
		if n.Type == model.NotificationTypeFollow {
			vo.FollowedByMe = followedSet[n.ActorID]
		}
		out = append(out, vo)
	}
	return out, nil
}

func (s *Service) logWarnf(format string, args ...interface{}) {
	if s.logger != nil {
		s.logger.Warnf(format, args...)
	}
}
