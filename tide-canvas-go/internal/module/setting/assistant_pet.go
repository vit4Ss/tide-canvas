package setting

import (
	"encoding/json"
	"sort"
	"strings"
)

// assistantPetStylesConfigKey 保存管理员维护的画布助手宠物样式列表。
const assistantPetStylesConfigKey = "canvas.assistant.petStyles"

// AssistantPetStyleVO 是用户端可选择的宠物样式。用户端只需要启用项和图片地址。
type AssistantPetStyleVO struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	ImageURL  string `json:"imageUrl"`
	Enabled   bool   `json:"enabled"`
	IsDefault bool   `json:"isDefault"`
	SortOrder int    `json:"sortOrder"`
	Sprite    *AssistantPetSpriteVO `json:"sprite,omitempty"`
}

// AssistantPetSpriteVO 描述精灵图的网格帧与动作行，前端按此裁切播放。
type AssistantPetSpriteVO struct {
	Kind          string                       `json:"kind,omitempty"`
	FrameWidth    int                          `json:"frameWidth,omitempty"`
	FrameHeight   int                          `json:"frameHeight,omitempty"`
	Columns       int                          `json:"columns,omitempty"`
	Rows          int                          `json:"rows,omitempty"`
	FPS           int                          `json:"fps,omitempty"`
	DefaultAction string                       `json:"defaultAction,omitempty"`
	Actions       []AssistantPetSpriteActionVO `json:"actions,omitempty"`
}

type AssistantPetSpriteActionVO struct {
	ID    string `json:"id,omitempty"`
	Name  string `json:"name,omitempty"`
	Row   int    `json:"row,omitempty"`
	Start int    `json:"start,omitempty"`
	Count int    `json:"count,omitempty"`
	FPS   int    `json:"fps,omitempty"`
	Loop  bool   `json:"loop,omitempty"`
}

// ListEnabledAssistantPetStyles 返回管理员已启用的样式；配置为空或格式异常时返回空列表。
func (s *Service) ListEnabledAssistantPetStyles() ([]AssistantPetStyleVO, error) {
	raw, err := s.repo.FindValue(assistantPetStylesConfigKey)
	if err != nil {
		return nil, err
	}
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return []AssistantPetStyleVO{}, nil
	}

	var all []AssistantPetStyleVO
	if err := json.Unmarshal([]byte(raw), &all); err != nil {
		return []AssistantPetStyleVO{}, nil
	}

	enabled := make([]AssistantPetStyleVO, 0, len(all))
	for _, item := range all {
		item.ID = strings.TrimSpace(item.ID)
		item.Name = strings.TrimSpace(item.Name)
		item.ImageURL = strings.TrimSpace(item.ImageURL)
		if !item.Enabled || item.ID == "" || item.ImageURL == "" {
			continue
		}
		if item.Name == "" {
			item.Name = "助手样式"
		}
		enabled = append(enabled, item)
	}

	sort.SliceStable(enabled, func(i, j int) bool {
		if enabled[i].SortOrder != enabled[j].SortOrder {
			return enabled[i].SortOrder < enabled[j].SortOrder
		}
		return enabled[i].Name < enabled[j].Name
	})
	return enabled, nil
}
