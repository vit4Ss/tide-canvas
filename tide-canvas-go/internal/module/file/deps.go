package file

import (
	"errors"
	"sync"
	"time"

	"github.com/sirupsen/logrus"
	"gorm.io/gorm"

	"github.com/tidecanvas/tide-canvas-go/internal/model"
)

// TeamProvider 团队共享关系提供者（对齐 TeamService 中文件模块所需的子集）。
// 方法名/签名与 team.Service 对齐，团队模块迁移后可直接注入其 *Service。
// TODO(wire): 由 router.New 注入 team 模块的真实实现（team.Service 已满足本接口）。
type TeamProvider interface {
	// GetTeamMemberIDs 当前用户可见资源的归属用户ID集合：
	// 无团队 → [userID]，有团队 → 全体成员ID（用于素材库共享可见性）。
	GetTeamMemberIDs(userID int64) ([]int64, error)
	// IsTeamAdminOf operator 是否为 ownerUserID 同团队的团队管理员（用于放行删除队友素材）。
	IsTeamAdminOf(operatorID, ownerUserID int64) (bool, error)
}

// UserFinder 用户只读查询（跨模块只读依赖，避免直接耦合 user 模块实现）。
// 用于把素材归属的内部 user_id 批量映射为对外 public_id，并读取存储额度做配额校验。
// TODO(wire): 由 router.New 注入（默认 NewDBUserFinder(db) 直读 sys_user 投影）。
type UserFinder interface {
	// PublicIDsByIDs 批量返回 内部用户ID → public_id 的映射（缺失的ID可不在结果中）。
	PublicIDsByIDs(ids []int64) (map[int64]string, error)
	// StorageQuotaOf 返回用户存储额度（字节）；用户不存在返回 (0,false,nil)。
	StorageQuotaOf(userID int64) (int64, bool, error)
}

// OperationLogger 操作日志记录器（对齐 GenerationLogRecorder.recordOperation）。
// 文件上传/删除/保存素材落一条操作日志，best-effort 不影响主流程。
type OperationLogger interface {
	// RecordOperation operationType: file_upload / file_delete / asset_save。
	RecordOperation(operationType string, userID int64, projectID *int64, operation string, success bool, resultURL, errorMsg string)
}

// TicketStore 直传预签名票据存储（对齐旧版 RedisTemplate 存 presign:* 票据）。
// 记录某对象键由哪个用户申请、内容类型与文件大类，供 register 闭环校验；一次性、带过期。
type TicketStore interface {
	// Set 写入票据，ttl 后自动过期。
	Set(key, value string, ttl time.Duration)
	// Get 读取票据，不存在或已过期返回 ("", false)。
	Get(key string) (string, bool)
	// Delete 删除票据（登记成功后作废，防重复登记）。
	Delete(key string)
}

// ---- 默认占位 / 降级实现（真实实现由 router 在相应模块迁移后注入）----

// DefaultTeamProvider 未接入团队模块时的降级实现：等价于“用户不在任何团队”。
type DefaultTeamProvider struct{}

// GetTeamMemberIDs 无团队：可见范围仅本人。
func (DefaultTeamProvider) GetTeamMemberIDs(userID int64) ([]int64, error) {
	return []int64{userID}, nil
}

// IsTeamAdminOf 无团队：恒非管理员。
func (DefaultTeamProvider) IsTeamAdminOf(operatorID, ownerUserID int64) (bool, error) {
	return false, nil
}

// DBUserFinder 基于共享数据库连接的 UserFinder：只读 sys_user 的 id/public_id/storage_quota 投影。
// 仅读取公开映射与配额，不触及敏感字段，也不写入。
type DBUserFinder struct{ db *gorm.DB }

// NewDBUserFinder 构造（传入 router 中共享的 *gorm.DB 或 userRepo.DB()）。
func NewDBUserFinder(db *gorm.DB) *DBUserFinder { return &DBUserFinder{db: db} }

// PublicIDsByIDs 批量查询 内部用户ID → public_id 映射。
func (f *DBUserFinder) PublicIDsByIDs(ids []int64) (map[int64]string, error) {
	result := make(map[int64]string, len(ids))
	if len(ids) == 0 {
		return result, nil
	}
	type row struct {
		ID       int64
		PublicID string
	}
	var rows []row
	if err := f.db.Model(&model.SysUser{}).
		Select("id", "public_id").
		Where("id IN ?", ids).
		Find(&rows).Error; err != nil {
		return nil, err
	}
	for _, r := range rows {
		result[r.ID] = r.PublicID
	}
	return result, nil
}

// StorageQuotaOf 查询用户存储额度（字节）。
func (f *DBUserFinder) StorageQuotaOf(userID int64) (int64, bool, error) {
	type row struct {
		StorageQuota int64
	}
	var r row
	err := f.db.Model(&model.SysUser{}).
		Select("storage_quota").
		Where("id = ?", userID).
		Take(&r).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return 0, false, nil
	}
	if err != nil {
		return 0, false, err
	}
	return r.StorageQuota, true, nil
}

// LogOperationLogger 开发期操作日志：仅打日志（真实落库实现待 ai 模块迁移）。
type LogOperationLogger struct{ Logger *logrus.Logger }

// RecordOperation 打印一条操作日志。
func (l LogOperationLogger) RecordOperation(operationType string, userID int64, projectID *int64, operation string, success bool, resultURL, errorMsg string) {
	if l.Logger == nil {
		return
	}
	l.Logger.WithFields(logrus.Fields{
		"type": operationType, "userId": userID, "success": success,
		"operation": operation, "resultUrl": resultURL, "error": errorMsg,
	}).Info("[file] 操作日志")
}

// MemoryTicketStore 内存版票据存储（带过期）。
// 单实例够用；多实例部署须换 Redis 实现（key 跨实例共享），由 router 注入。
type MemoryTicketStore struct {
	mu sync.Mutex
	m  map[string]ticketEntry
}

type ticketEntry struct {
	value    string
	expireAt time.Time
}

// NewMemoryTicketStore 构造。
func NewMemoryTicketStore() *MemoryTicketStore {
	return &MemoryTicketStore{m: make(map[string]ticketEntry)}
}

// Set 写入票据。
func (s *MemoryTicketStore) Set(key, value string, ttl time.Duration) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.m[key] = ticketEntry{value: value, expireAt: time.Now().Add(ttl)}
}

// Get 读取票据（过期即删并视为不存在）。
func (s *MemoryTicketStore) Get(key string) (string, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	e, ok := s.m[key]
	if !ok {
		return "", false
	}
	if time.Now().After(e.expireAt) {
		delete(s.m, key)
		return "", false
	}
	return e.value, true
}

// Delete 删除票据。
func (s *MemoryTicketStore) Delete(key string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.m, key)
}
