package admin

import (
	"encoding/json"

	"github.com/gin-gonic/gin"

	"github.com/tidecanvas/tide-canvas-go/pkg/ecode"
	"github.com/tidecanvas/tide-canvas-go/pkg/response"
)

// vipLevelsConfigKey 会员等级配置在 sys_config 的键（与 ai 模块读取的 "vip.levels" 一致）。
const vipLevelsConfigKey = "vip.levels"

// VipLevelVO 会员等级配置项（与前端及 sys_config 的 JSON 对齐）。
type VipLevelVO struct {
	Level       int    `json:"level"`
	Name        string `json:"name"`
	Concurrency int    `json:"concurrency"` // 该等级 AI 并发上限，0=不限
}

// VipLevelAdminService 会员等级配置（读写 sys_config 的 vip.levels）。
type VipLevelAdminService struct {
	repo *Repository
}

// NewVipLevelAdminService 构造。
func NewVipLevelAdminService(repo *Repository) *VipLevelAdminService {
	return &VipLevelAdminService{repo: repo}
}

// List 读取等级配置；为空 / 解析失败时返回默认一档（VIP1 不限）。
func (s *VipLevelAdminService) List() []VipLevelVO {
	raw := s.repo.GetConfigStr(vipLevelsConfigKey)
	if raw != "" {
		var levels []VipLevelVO
		if err := json.Unmarshal([]byte(raw), &levels); err == nil && len(levels) > 0 {
			return levels
		}
	}
	return []VipLevelVO{{Level: 1, Name: "VIP1", Concurrency: 0}}
}

// Save 保存等级配置（序列化为 JSON 存入 sys_config）。
func (s *VipLevelAdminService) Save(levels []VipLevelVO) error {
	b, err := json.Marshal(levels)
	if err != nil {
		return err
	}
	return s.repo.UpsertConfig(vipLevelsConfigKey, string(b))
}

// ---- HTTP handlers（挂载于 /api/admin/vip-levels，已 JWTAuth + AdminOnly）----

// listVipLevels GET /api/admin/vip-levels 会员等级配置（权限码 setting:view）。
func (h *Handler) listVipLevels(c *gin.Context) {
	response.OK(c, h.vipLevelSvc.List())
}

// saveVipLevels PUT /api/admin/vip-levels 保存会员等级配置（权限码 setting:edit）。
func (h *Handler) saveVipLevels(c *gin.Context) {
	var levels []VipLevelVO
	if err := c.ShouldBindJSON(&levels); err != nil {
		response.Fail(c, ecode.BadRequest)
		return
	}
	if err := h.vipLevelSvc.Save(levels); err != nil {
		response.FailErr(c, err)
		return
	}
	response.OK(c, nil)
}
