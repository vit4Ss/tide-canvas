package chat

import (
	"time"

	"gorm.io/gorm"

	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/idgen"
)

// Seed inserts a couple of demo conversations (each with a user prompt and a
// placeholder assistant reply) for the seeded admin user. It is idempotent: if
// the admin already has any conversation, or no admin exists yet, it is a no-op.
// Call after model.Seed (which creates the admin) and AutoMigrate.
func Seed(db *gorm.DB) error {
	// Resolve the seeded admin (role 9). Without an admin there is nothing to
	// attach demo conversations to.
	var admin model.User
	if err := db.Select("id").Where("role = ?", 9).Order("create_time ASC").First(&admin).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			return nil
		}
		return err
	}

	// Idempotency: skip if the admin already owns any conversation.
	var existing int64
	if err := db.Model(&model.IMConversation{}).Where("owner_id = ?", admin.ID).Count(&existing).Error; err != nil {
		return err
	}
	if existing > 0 {
		return nil
	}

	now := time.Now()

	type seedMsg struct {
		fromUser bool
		content  string
	}
	type seedConv struct {
		title string
		msgs  []seedMsg
	}

	convs := []seedConv{
		{
			title: "欢迎使用 TideCanvas 助手",
			msgs: []seedMsg{
				{fromUser: true, content: "你好，TideCanvas 能帮我做什么？"},
				{fromUser: false, content: "[占位回复] AI 暂未接入：当前还没有配置大模型密钥，这是一条自动生成的占位回复。配置密钥后我可以帮你生成图像、视频与创意文案。"},
			},
		},
		{
			title: "海报创意头脑风暴",
			msgs: []seedMsg{
				{fromUser: true, content: "帮我想几个夏日新品海报的创意方向。"},
				{fromUser: false, content: "[占位回复] AI 暂未接入：这是一条自动生成的占位回复。接入大模型后，我会根据你的品牌与主题给出具体的海报创意方向。"},
			},
		},
	}

	return db.Transaction(func(tx *gorm.DB) error {
		for ci, sc := range convs {
			conv := &model.IMConversation{
				BaseModel: model.BaseModel{ID: idgen.Next()},
				Type:      "ai",
				Title:     sc.title,
				OwnerID:   admin.ID,
			}

			var lastMsgID idgen.ID
			var lastAt time.Time
			msgs := make([]model.IMMessage, 0, len(sc.msgs))
			for mi, sm := range sc.msgs {
				// Stagger timestamps so ordering is deterministic.
				at := now.Add(time.Duration(ci) * time.Minute).Add(time.Duration(mi) * time.Second)
				sender := assistantSenderID
				if sm.fromUser {
					sender = admin.ID
				}
				id := idgen.Next()
				msgs = append(msgs, model.IMMessage{
					BaseModel:      model.BaseModel{ID: id, CreateTime: at, UpdateTime: at},
					ConversationID: conv.ID,
					SenderID:       sender,
					ContentType:    "text",
					Content:        sm.content,
					Status:         0,
				})
				lastMsgID = id
				lastAt = at
			}

			conv.LastMessageID = &lastMsgID
			conv.LastMessageAt = &lastAt
			if err := tx.Create(conv).Error; err != nil {
				return err
			}
			if len(msgs) > 0 {
				if err := tx.Create(&msgs).Error; err != nil {
					return err
				}
			}

			// Register the admin as the owner-member of the conversation.
			member := &model.IMConversationMember{
				BaseModel:      model.BaseModel{ID: idgen.Next()},
				ConversationID: conv.ID,
				UserID:         admin.ID,
				Role:           2,
			}
			if err := tx.Create(member).Error; err != nil {
				return err
			}
		}
		return nil
	})
}
