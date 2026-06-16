package im

import (
	"errors"

	"gorm.io/gorm"
)

// UserBrief 用户摘要（跨模块只读 sys_user 投影，避免直接耦合 user 模块）。
type UserBrief struct {
	PublicID string
	Nickname string
	Avatar   string
}

// UserFinder 用户 public_id ↔ 内部ID 解析与摘要查询。
type UserFinder interface {
	ResolveID(publicID string) (int64, error)
	ResolveIDs(publicIDs []string) ([]int64, error)
	Brief(userIDs []int64) (map[int64]UserBrief, error)
}

// DBUserFinder 直读 sys_user 的默认实现。
type DBUserFinder struct{ db *gorm.DB }

// NewDBUserFinder 构造。
func NewDBUserFinder(db *gorm.DB) *DBUserFinder { return &DBUserFinder{db: db} }

type userRow struct {
	ID       int64
	PublicID string
	Nickname string
	Avatar   string
}

// ResolveID public_id → 内部ID；不存在返回 error。
func (f *DBUserFinder) ResolveID(publicID string) (int64, error) {
	var row userRow
	err := f.db.Table("sys_user").Select("id").
		Where("public_id = ? AND deleted = 0", publicID).First(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return 0, errors.New("user not found")
	}
	if err != nil {
		return 0, err
	}
	return row.ID, nil
}

// ResolveIDs 批量 public_id → 内部ID（过滤不存在者）。
func (f *DBUserFinder) ResolveIDs(publicIDs []string) ([]int64, error) {
	if len(publicIDs) == 0 {
		return nil, nil
	}
	var ids []int64
	err := f.db.Table("sys_user").
		Where("public_id IN ? AND deleted = 0", publicIDs).Pluck("id", &ids).Error
	return ids, err
}

// Brief 批量取用户摘要（id → 昵称/头像/public_id）。
func (f *DBUserFinder) Brief(userIDs []int64) (map[int64]UserBrief, error) {
	out := make(map[int64]UserBrief)
	if len(userIDs) == 0 {
		return out, nil
	}
	var rows []userRow
	err := f.db.Table("sys_user").Select("id, public_id, nickname, avatar").
		Where("id IN ?", userIDs).Find(&rows).Error
	if err != nil {
		return nil, err
	}
	for _, r := range rows {
		out[r.ID] = UserBrief{PublicID: r.PublicID, Nickname: r.Nickname, Avatar: r.Avatar}
	}
	return out, nil
}
