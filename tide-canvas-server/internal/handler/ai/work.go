package ai

// work.go — 生成成功后把产出登记为一条作品(community_post)，供后台「作品管理」
// 管理。图片 / 视频 / 音频都登记，文本对话不登记(没有可展示的产出)。
//
// 状态一律落 0 未发布：community 的公开 feed 只查 status = 1，所以在管理员
// 后台发布之前，用户的作品不会出现在广场上。这里没有「投稿」动作——生成成功
// 即入库，是作品管理的唯一数据来源。
//
// 判重靠 community_post.task_id：一次生成只登记一条，重复调用是空操作。

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"unicode/utf8"

	"go.uber.org/zap"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/idgen"
	"tidecanvas/internal/pkg/logger"
)

// workMeta is the JSON blob stored in CommunityPost.Content. 键名与
// handler/community/vo.go 的 postMeta、admin/g2_works.go 的 workMeta 对齐——
// 三处读同一份 blob，加字段要同步。
type workMeta struct {
	Type     string `json:"type"`               // image | video | audio
	Model    string `json:"model"`              // 模型展示名
	Desc     string `json:"desc"`               // 列表/详情的描述
	Prompt   string `json:"prompt"`             // 原始提示词
	VideoURL string `json:"videoUrl,omitempty"` // 视频源(封面另存)
	AudioURL string `json:"audioUrl,omitempty"` // 音频源
}

// workTypeOf maps a handler operation type to the work modality.
// 空串表示这类产出不作为作品登记(如 chat)。
func workTypeOf(op string) string {
	switch op {
	case "video":
		return "video"
	case "audio":
		return "audio"
	case "generation", "edits":
		return "image"
	default:
		return ""
	}
}

func skillOutputTypeOf(handler GenHandler) string {
	if handler == nil {
		return ""
	}
	if handler.Name() == assistantChatHandler || handler.Name() == skillTextCompletionHandler {
		return "text"
	}
	return workTypeOf(handler.OperationType())
}

// workTitle derives a short display title from the prompt (首行、最多 40 字)。
// 提示词为空时回落到模型名，保证列表里不出现无题行。
func workTitle(prompt, modelName string) string {
	t := strings.TrimSpace(prompt)
	if i := strings.IndexAny(t, "\r\n"); i >= 0 {
		t = strings.TrimSpace(t[:i])
	}
	if t == "" {
		return strings.TrimSpace(modelName)
	}
	// 按 rune 截断：按字节切会把中文切成半个字，落库变乱码
	if utf8.RuneCountInString(t) > 40 {
		r := []rune(t)
		t = string(r[:40]) + "…"
	}
	return t
}

// applySkill prepends the skill's prompt template to the user's description when
// the input carries a skillId, and removes the key so it never reaches upstream.
//
// 口径与前端原先的 mergeSkillPrompt 一致:模板在前定基调,用户描述随后,空行分隔。
// 技能模态与本次生成不符(拿图片技能去生成视频)时直接忽略,不做拼接。
// 查不到技能 / 模板为空 一律按「没带技能」处理——技能是增强项,不该挡住生成。
func (s *service) applySkill(input map[string]any, gh GenHandler) map[string]any {
	if input == nil {
		return input
	}
	raw := strings.TrimSpace(strField(input, "skillId"))
	delete(input, "skillId") // 无论后续成不成，都不能把它透给上游
	if raw == "" {
		return input
	}
	id, err := idgen.Parse(raw)
	if err != nil {
		return input
	}
	var sk model.Skill
	if err := s.repo.db.Select("prompt_template", "output_type", "kind").
		Where("id = ? AND status = 1", id).First(&sk).Error; err != nil {
		return input
	}
	tmpl := strings.TrimSpace(sk.PromptTemplate)
	if sk.Kind != model.SkillKindPreset || tmpl == "" || sk.OutputType != skillOutputTypeOf(gh) {
		return input
	}
	return applyPromptTemplate(input, tmpl)
}

// applyPromptTemplate merges a skill template into input["prompt"]：模板在前定
// 基调、用户描述随后，空行分隔（与客户端原先的 mergeSkillPrompt 同一口径）。
//
// 只在 prompt 键本来就存在时动手：音乐的自定义歌词/延长/翻唱模式是刻意不发
// prompt 的（上游有 lyrics 时忽略描述），凭空造一个键等于往这类请求里注入了
// 一段本不该有的描述。键在但为空 → 只发模板。
func applyPromptTemplate(input map[string]any, tmpl string) map[string]any {
	cur, ok := input["prompt"]
	if !ok {
		return input
	}
	user, _ := cur.(string) // 非字符串按空处理，走下面的「只发模板」分支
	if user = strings.TrimSpace(user); user != "" {
		input["prompt"] = tmpl + "\n\n" + user
	} else {
		input["prompt"] = tmpl
	}
	return input
}

// registerWork inserts the finished generation as an unpublished work. Failures
// are logged and swallowed — 登记不成功不该影响用户已经拿到的生成结果。
func (s *service) registerWork(ctx context.Context, task *model.AiTask, gh GenHandler, m *model.AiModel, userID idgen.ID, dto generateDTO, res GenerateResult) {
	if err := s.registerWorkOnDB(s.repo.db.WithContext(ctx), task, gh, m, userID, dto, res); err != nil {
		logger.L().Warn("ai: register work failed", zap.String("taskId", task.ID.String()), zap.Error(err))
	}
}

func (s *service) registerWorkOnDB(db *gorm.DB, task *model.AiTask, gh GenHandler, m *model.AiModel, userID idgen.ID, dto generateDTO, res GenerateResult) error {
	kind := workTypeOf(gh.OperationType())
	if kind == "" || res.ResultURL == "" || userID == 0 {
		return nil
	}

	// 判重：同一个任务只登记一条(重试/重复调用时是空操作)。
	var n int64
	if err := db.Model(&model.CommunityPost{}).
		Where("task_id = ?", task.ID).Count(&n).Error; err != nil || n > 0 {
		return err
	}

	// dto.Input 里存的是用户原文（技能模板由 applySkill 在发上游时才拼），
	// 所以标题/描述拿到的是用户自己写的那句，不是技能模板开头。
	prompt := strField(decodeInput(dto.Input), "prompt")
	title := workTitle(prompt, m.Name)

	// 批量出图：一张图算一件作品。res.URLs 是本次的全部产出，只有一张时退回
	// ResultURL（视频/音频本来就是单件）。
	urls := res.URLs
	if len(urls) == 0 {
		urls = []string{res.ResultURL}
	}

	for _, u := range urls {
		if strings.TrimSpace(u) == "" {
			continue
		}
		meta := workMeta{Type: kind, Model: m.Name, Desc: prompt, Prompt: prompt}
		cover := u
		switch kind {
		case "video":
			// 结果是视频源，不能当封面塞进 <img>；封面留空由展示端兜底。
			meta.VideoURL = u
			cover = ""
		case "audio":
			meta.AudioURL = u
			cover = ""
		}
		blob, err := json.Marshal(meta)
		if err != nil {
			return err
		}
		post := &model.CommunityPost{
			UserID:   userID,
			TaskID:   task.ID,
			Title:    title,
			Content:  string(blob),
			CoverURL: cover,
			Status:   0, // 未发布
		}
		if err := db.Create(post).Error; err != nil {
			return err
		}
	}
	return nil
}

// promoteTask turns a successful orchestration draft into a final, visible
// generation after an approval step. The AiTask row is locked and the work rows
// are created in the same transaction, making retries after a crash idempotent.
func (s *service) promoteTask(ctx context.Context, userID, taskID idgen.ID) error {
	return s.repo.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		return s.promoteTaskTx(ctx, tx, userID, taskID)
	})
}

func (s *service) promoteTaskTx(ctx context.Context, tx *gorm.DB, userID, taskID idgen.ID) error {
	var task model.AiTask
	if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&task, "id = ?", taskID).Error; err != nil {
		return err
	}
	if task.UserID != userID {
		return errTaskForbidden
	}
	if task.Status != statusSuccess {
		return errors.New("only successful generation tasks can be promoted")
	}
	gh, ok := s.registry.get(task.Handler)
	if !ok {
		return errNoHandler
	}
	// Promotion does not perform inference, so it must remain possible if the
	// catalog model was delisted after this task had already succeeded.
	m := &model.AiModel{ID: task.ModelID, Name: task.ModelName}
	meta := map[string]any{}
	if strings.TrimSpace(task.ResultMeta) != "" {
		_ = json.Unmarshal([]byte(task.ResultMeta), &meta)
	}
	urls := []string{}
	if raw, ok := meta["urls"].([]any); ok {
		for _, value := range raw {
			if url, ok := value.(string); ok && strings.TrimSpace(url) != "" {
				urls = append(urls, strings.TrimSpace(url))
			}
		}
	}
	res := GenerateResult{ResultURL: task.ResultUrl, URLs: urls, Meta: meta}
	dto := generateDTO{Handler: task.Handler, ProjectID: task.ProjectID, Input: json.RawMessage(task.Input)}
	if err := s.registerWorkOnDB(tx, &task, gh, m, userID, dto, res); err != nil {
		return err
	}
	return tx.Model(&model.AiTask{}).Where("id = ?", task.ID).
		Updates(map[string]any{"register_work": true, "output_role": "final"}).Error
}
