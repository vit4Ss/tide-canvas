package follow

import (
	"strings"

	"github.com/sirupsen/logrus"

	"github.com/tidecanvas/tide-canvas-go/internal/model"
	"github.com/tidecanvas/tide-canvas-go/pkg/ecode"
)

// Service 关注业务逻辑。入参用对方 public_id，内部解析为雪花主键；业务错误返回 *ecode.Error。
type Service struct {
	repo     *Repository
	users    UserFinder
	notifier Notifier // 可选：关注成功后发通知；nil 表示未接入通知系统（nil 安全）。
	logger   *logrus.Logger
}

// NewService 构造关注服务。
// users 为跨模块只读依赖（见 deps.go）：由 router.New 注入 NewDBUserFinder(db)。logger 可为 nil。
func NewService(repo *Repository, users UserFinder, logger *logrus.Logger) *Service {
	return &Service{repo: repo, users: users, logger: logger}
}

// SetNotifier 注入通知投递（可选）。由 router.New 在 notification 模块装配后调用；不调用则不发通知。
func (s *Service) SetNotifier(n Notifier) { s.notifier = n }

// pageData 服务层分页载荷，由 handler 转交 response.Page 输出。
type pageData struct {
	Records  []FollowUserVO
	Total    int64
	PageNum  int
	PageSize int
}

// Follow 关注：targetPublicID 为对方对外 public_id。禁止关注自己；对方不存在返回 404。
func (s *Service) Follow(userID int64, targetPublicID string) error {
	targetID, err := s.resolveTarget(targetPublicID)
	if err != nil {
		return err
	}
	if targetID == userID {
		return ecode.BadRequest.WithMessage("不能关注自己")
	}
	if err := s.repo.Follow(userID, targetID); err != nil {
		return err
	}
	// 关注成功 → 异步给被关注者发「关注了你」通知（失败不影响主流程）。
	s.notifyFollow(targetID, userID)
	return nil
}

// notifyFollow 异步投递关注通知（receiver=被关注者, actor=关注者）。
// go + recover 包裹，写通知失败/panic 仅告警，绝不影响关注主流程（对齐 log.RecordOperation）。
func (s *Service) notifyFollow(followeeID, followerID int64) {
	if s.notifier == nil {
		return
	}
	go func() {
		defer func() {
			if r := recover(); r != nil {
				s.logWarnf("发送关注通知 panic: %v", r)
			}
		}()
		if err := s.notifier.CreateNotification(followeeID, followerID, model.NotificationTypeFollow, "", 0, "关注了你"); err != nil {
			s.logWarnf("发送关注通知失败: %v", err)
		}
	}()
}

// logWarnf 告警日志（logger 为 nil 时静默）。
func (s *Service) logWarnf(format string, args ...interface{}) {
	if s.logger != nil {
		s.logger.Warnf(format, args...)
	}
}

// Unfollow 取关：targetPublicID 为对方对外 public_id。幂等（未关注也返回成功）。
func (s *Service) Unfollow(userID int64, targetPublicID string) error {
	targetID, err := s.resolveTarget(targetPublicID)
	if err != nil {
		return err
	}
	if targetID == userID {
		return ecode.BadRequest.WithMessage("不能取关自己")
	}
	return s.repo.Unfollow(userID, targetID)
}

// Status 关注状态：当前用户是否已关注对方(following) / 对方是否关注了当前用户(followedBy)。
func (s *Service) Status(userID int64, targetPublicID string) (*FollowStatusVO, error) {
	targetID, err := s.resolveTarget(targetPublicID)
	if err != nil {
		return nil, err
	}
	// 自己对自己：两者均 false（前端通常不展示关注按钮，这里仍给出确定语义）。
	if targetID == userID {
		return &FollowStatusVO{}, nil
	}
	following, err := s.repo.IsFollowing(userID, targetID)
	if err != nil {
		return nil, err
	}
	followedBy, err := s.repo.IsFollowing(targetID, userID)
	if err != nil {
		return nil, err
	}
	return &FollowStatusVO{Following: following, FollowedBy: followedBy}, nil
}

// CountFollowing 我关注的人数。
func (s *Service) CountFollowing(userID int64) (int64, error) {
	return s.repo.CountFollowing(userID)
}

// CountFollowers 关注我的人数。
func (s *Service) CountFollowers(userID int64) (int64, error) {
	return s.repo.CountFollowers(userID)
}

// ListFollowing 我关注的人（分页）。relationUserID 取每行 followee_id。
func (s *Service) ListFollowing(userID int64, query *FollowQuery) (*pageData, error) {
	query.normalize()
	rows, total, err := s.repo.ListFollowing(userID, query.PageNum, query.PageSize)
	if err != nil {
		return nil, err
	}
	vos, err := s.buildVOs(userID, rows, func(f model.SysFollow) int64 { return f.FolloweeID })
	if err != nil {
		return nil, err
	}
	return &pageData{Records: vos, Total: total, PageNum: query.PageNum, PageSize: query.PageSize}, nil
}

// ListFollowers 关注我的人（分页）。relationUserID 取每行 follower_id。
func (s *Service) ListFollowers(userID int64, query *FollowQuery) (*pageData, error) {
	query.normalize()
	rows, total, err := s.repo.ListFollowers(userID, query.PageNum, query.PageSize)
	if err != nil {
		return nil, err
	}
	vos, err := s.buildVOs(userID, rows, func(f model.SysFollow) int64 { return f.FollowerID })
	if err != nil {
		return nil, err
	}
	return &pageData{Records: vos, Total: total, PageNum: query.PageNum, PageSize: query.PageSize}, nil
}

// ===== 内部辅助 =====

// resolveTarget 将对方 public_id 解析为内部主键；空串 400，用户不存在 404。
func (s *Service) resolveTarget(publicID string) (int64, error) {
	if strings.TrimSpace(publicID) == "" {
		return 0, ecode.BadRequest
	}
	id, err := s.users.IDByPublicID(publicID)
	if err != nil {
		return 0, err
	}
	if id == nil {
		return 0, ecode.AccountNotFound
	}
	return *id, nil
}

// buildVOs 把关注关系行批量转为用户摘要 VO：批量取用户资料 + 批量标注 following / followedBy，避免 N+1。
// relationUserID 从一行关系中取出「列表里要展示的那个用户」的内部ID（关注列表取 followee，粉丝列表取 follower）。
func (s *Service) buildVOs(currentUserID int64, rows []model.SysFollow, relationUserID func(model.SysFollow) int64) ([]FollowUserVO, error) {
	out := make([]FollowUserVO, 0, len(rows))
	if len(rows) == 0 {
		return out, nil
	}

	ids := make([]int64, 0, len(rows))
	for _, f := range rows {
		ids = append(ids, relationUserID(f))
	}

	users, err := s.users.FindUsers(ids)
	if err != nil {
		return nil, err
	}
	// 当前用户对这批用户的关注关系（following）与这批用户对当前用户的关注关系（followedBy）。
	followingSet, err := s.repo.FollowingSet(currentUserID, ids)
	if err != nil {
		return nil, err
	}
	followerSet, err := s.repo.FollowerSet(currentUserID, ids)
	if err != nil {
		return nil, err
	}

	for _, f := range rows {
		uid := relationUserID(f)
		vo := FollowUserVO{
			Following:  followingSet[uid],
			FollowedBy: followerSet[uid],
			FollowTime: f.CreateTime,
		}
		if u, ok := users[uid]; ok {
			vo.ID = u.PublicID
			vo.Username = u.Username
			vo.Nickname = u.Nickname
			vo.Avatar = u.Avatar
		}
		out = append(out, vo)
	}
	return out, nil
}
