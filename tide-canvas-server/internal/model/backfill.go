package model

// backfill.go — 一次性数据迁移的通用外壳。
//
// 出厂基线(角色/工具/楼层/配置)一律「缺则插、存在绝不覆盖」,以免重启把管理员
// 的修改冲掉。代价是:给基线补一个新字段或新键时,存量库的既有行永远拿不到它
// (新菜单键对全体存量用户隐身、新开关始终是旧值)。这类补齐只能做一次——做完
// 必须留痕,否则每次重启都会把管理员之后的相反修改再改回来。

import (
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// runOnce executes fn at most once per markKey across the lifetime of a database.
// 标记行落在 sys_config 的 internal 分组(后台「配置管理」不展示,避免被当成
// 可调设置误删——删掉就等于让迁移重跑)。
//
// fn 必须自身幂等:标记写入失败(或进程在 fn 与写标记之间崩溃)会让它下次重跑。
func runOnce(db *gorm.DB, markKey, description string, fn func(*gorm.DB) error) error {
	// Unscoped:标记行被软删后仍占着 config_key 唯一索引,普通 Count 看不见它,
	// 于是 fn 每次启动都重跑、而补写标记又被 DoNothing 吞掉——管理员刚关掉的
	// 开关会被一路改回来。含软删地判断,才是真正的「只跑一次」。
	var n int64
	if err := db.Unscoped().Model(&SysConfig{}).Where("config_key = ?", markKey).Count(&n).Error; err != nil {
		return err
	}
	if n > 0 {
		return nil
	}
	if err := fn(db); err != nil {
		return err
	}
	// 多实例同时启动会同时走到这里:config_key 唯一索引下第二次插入必冲突,
	// 不吞掉就会让那个实例启动失败(fn 幂等,标记重复插入无害)。
	return db.Clauses(clause.OnConflict{DoNothing: true}).Create(&SysConfig{
		ConfigKey:   markKey,
		ConfigValue: "done",
		Group:       ConfigGroupInternal,
		Description: description,
	}).Error
}
