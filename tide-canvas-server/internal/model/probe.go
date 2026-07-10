package model

import (
	"strconv"
	"strings"
	"time"

	"gorm.io/gorm"

	"tidecanvas/internal/pkg/idgen"
)

// ConfigKeyProbeInterval is the sys_config key holding the model-availability
// probe interval in seconds (0 = probing disabled). Seeded by the prober on
// boot; edited in the admin 配置管理 screen and re-read every cycle, so changes
// apply WITHOUT a restart. Drives the admin 模型状态 page.
const ConfigKeyProbeInterval = "models.probeIntervalSec"

// ModelProbe is one availability-probe sample for a market model（后台
// 「模型状态」页数据源）。text 模型走真实流式补全探测（FirstMs=首字时延、
// TotalMs=完成时延）；图片/视频/音频走上游目录可达性探测（TotalMs=目录
// 拉取耗时，FirstMs=0）。行由 internal/prober 定时写入并按保留期修剪。
type ModelProbe struct {
	ID       idgen.ID `gorm:"column:id;primaryKey;autoIncrement:false" json:"id"`
	ModelID  idgen.ID `gorm:"column:model_id;index:idx_probe_model_time,priority:1" json:"modelId"`
	ModelKey string   `gorm:"column:model_key;type:varchar(128)" json:"modelKey"`
	// Kind: chat（流式补全）/ catalog（上游目录可达）。
	Kind string `gorm:"column:kind;type:varchar(16);not null" json:"kind"`
	// OK 无 default 标签：带 default 的 bool 在 struct Create 下会吞掉 false
	//（见 admin/create_fix.go 的教训），失败样本必须能如实落库。
	OK       bool   `gorm:"column:ok;not null" json:"ok"`
	FirstMs  int64  `gorm:"column:first_ms;not null" json:"firstMs"`
	TotalMs  int64  `gorm:"column:total_ms;not null" json:"totalMs"`
	ErrorMsg string `gorm:"column:error_msg;type:varchar(512)" json:"errorMsg"`

	CreateTime time.Time `gorm:"column:create_time;autoCreateTime;index:idx_probe_model_time,priority:2" json:"createTime"`
}

// TableName overrides the default pluralization.
func (ModelProbe) TableName() string { return "model_probe" }

// BeforeCreate assigns a snowflake ID when one has not been set explicitly
// (no BaseModel embed: probes are high-volume rows that don't need soft delete
// or update_time).
func (p *ModelProbe) BeforeCreate(_ *gorm.DB) error {
	if p.ID == 0 {
		p.ID = idgen.Next()
	}
	return nil
}

// DefaultProbeIntervalSec is the factory probe cadence（5 分钟：text 探测是
// 真实补全调用，过密会消耗上游额度）。
const DefaultProbeIntervalSec = 300

// minProbeIntervalSec floors admin-configured cadence to protect the relay.
const minProbeIntervalSec = 30

// ProbeIntervalSec reads the configured probe interval (seconds). 0 disables
// probing; positive values are floored to minProbeIntervalSec. Shared by the
// prober loop and the admin 模型状态 endpoint so「下次检测」与实际节奏一致。
func ProbeIntervalSec(db *gorm.DB) int {
	var row SysConfig
	err := db.Select("config_value").
		Where("config_key = ?", ConfigKeyProbeInterval).
		First(&row).Error
	if err != nil {
		return DefaultProbeIntervalSec
	}
	n, convErr := strconv.Atoi(strings.TrimSpace(row.ConfigValue))
	if convErr != nil {
		return DefaultProbeIntervalSec
	}
	if n <= 0 {
		return 0
	}
	if n < minProbeIntervalSec {
		return minProbeIntervalSec
	}
	return n
}
