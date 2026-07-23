package admin

// g2_blog_ai.go implements POST /admin/blog/posts/ai-polish：博客编辑弹窗的
// 「AI 优化」按钮。把（多为 Telegram 导入的）文章交给中转站文本模型清稿：
// 去广告引流、理顺文案、合并重复段落，prompt 代码块原样保留，产出
// 标题/摘要/正文三件套回填表单——是否落库由管理员核对后点保存决定。
//
// 模型选择与创作台「AI 优化」同源：模型管理里的「AI 优化主模型」，
// 缺省回落任一已上架文本模型（见 internal/handler/ai/repo.go 同款查询）。

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"tidecanvas/internal/middleware"
	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/eventlog"
	"tidecanvas/internal/pkg/relaychat"
	"tidecanvas/internal/pkg/response"
)

// BlogPolishDTO carries the current editor form values.
type BlogPolishDTO struct {
	Title   string `json:"title" binding:"omitempty,max=255"`
	Summary string `json:"summary" binding:"omitempty,max=512"`
	Content string `json:"content" binding:"required"`
}

// BlogPolishVO is the polished result（回填编辑表单，不直接落库）.
type BlogPolishVO struct {
	Title   string `json:"title"`
	Summary string `json:"summary"`
	Content string `json:"content"`
}

const blogPolishSystemPrompt = `你是一名中文科技博客的资深编辑。用户给你一篇从 Telegram 频道导入的草稿（标题/摘要/正文），请把它清理成一篇可直接发布的博客文章。

必须删除：
- 一切广告与引流内容：机器人推广（如「打开我们的 Bot」「一键绘图」）、VPN 推广、频道导流链接、教程目录/邪修频道等推广行、分割线后的推广区块
- 「评论区补充」「原帖完整提示词」这类搬运痕迹的标题——其中有价值的内容要融合进正文，而不是原样保留结构
- 与正文重复的段落（正文和评论区常各有一份提示词，只保留最完整的一份）

必须保留（一字不改）：
- 所有 Markdown 代码块（三个反引号包裹的内容）里的提示词原文——这是文章最有价值的部分；若正文与评论区的两份提示词内容不同，保留更完整的那份
- 图片与视频的 Markdown 引用（![](…) 与 ![video](…)），位置可以随文章结构微调

优化要求：
- 理顺不通顺、跳跃的表述，使行文连贯自然，但不要改变原意、不要凭空添加事实
- 标题去掉表情符号与频道栏目前缀，凝练成博客标题
- 摘要为一句话（60 字内），概括文章看点
- 结尾的话题标签（#xxx）删除
- 正文用 Markdown，小标题用 ##

只输出一个 JSON 对象，不要任何其他文字或代码块围栏：
{"title":"…","summary":"…","content":"…"}`

func (h *blogHandler) aiPolish(c *gin.Context) {
	var dto BlogPolishDTO
	if err := c.ShouldBindJSON(&dto); err != nil {
		response.Fail(c, response.CodeBadRequest, "请先填写正文")
		return
	}
	if h.relay == nil {
		response.Fail(c, response.CodeServerError, "AI 优化未启用：未配置中转站密钥")
		return
	}
	modelKey := h.polishModelKey()
	if modelKey == "" {
		response.Fail(c, response.CodeServerError, "AI 优化未启用：请在模型管理添加文本模型并设为「AI 优化主模型」")
		return
	}

	userInput, _ := json.Marshal(map[string]string{
		"title":   strings.TrimSpace(dto.Title),
		"summary": strings.TrimSpace(dto.Summary),
		"content": dto.Content,
	})
	msgs := []relaychat.Msg{
		{Role: "system", Content: blogPolishSystemPrompt},
		{Role: "user", Content: string(userInput)},
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), 180*time.Second)
	defer cancel()
	start := time.Now()
	reply, err := h.relay.Chat(ctx, modelKey, msgs)
	reqBody, _ := json.Marshal(msgs)
	eventlog.ModelText(middleware.CurrentUserID(c), "blog-polish", modelKey,
		"/v1/chat/completions", string(reqBody), reply, start, err)
	if err != nil {
		response.Fail(c, response.CodeServerError, "AI 优化失败，请稍后重试")
		return
	}

	vo, perr := parsePolishReply(reply)
	if perr != nil {
		response.Fail(c, response.CodeServerError, "AI 返回格式异常，请重试")
		return
	}
	response.OK(c, vo)
}

// parsePolishReply extracts the {title, summary, content} JSON from the model
// reply（容忍代码块围栏与前后杂讯：截取首个 { 到末个 }）。
func parsePolishReply(reply string) (*BlogPolishVO, error) {
	s := strings.TrimSpace(reply)
	if i := strings.Index(s, "{"); i >= 0 {
		if j := strings.LastIndex(s, "}"); j > i {
			s = s[i : j+1]
		}
	}
	var vo BlogPolishVO
	if err := json.Unmarshal([]byte(s), &vo); err != nil {
		return nil, err
	}
	if strings.TrimSpace(vo.Content) == "" {
		return nil, errors.New("empty content")
	}
	vo.Title = strings.TrimSpace(vo.Title)
	vo.Summary = strings.TrimSpace(vo.Summary)
	return &vo, nil
}

// polishModelKey picks the relay text model（与创作台 AI 优化同款口径：
// 「AI 优化主模型」优先，回落任一已上架文本模型）。
func (h *blogHandler) polishModelKey() string {
	const base = "type = ? AND status = 1 AND model_key <> ''"
	var m model.MarketModel
	if err := h.db.Where(base, "text").
		Where("config LIKE ?", `%"aiOptimizePrimary":true%`).
		Order("update_time DESC").First(&m).Error; err == nil && m.ModelKey != "" {
		return m.ModelKey
	}
	if err := h.db.Where(base, "text").Order("update_time DESC").First(&m).Error; err == nil {
		return m.ModelKey
	}
	return ""
}
