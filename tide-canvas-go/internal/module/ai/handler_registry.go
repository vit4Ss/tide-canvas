package ai

import (
	"fmt"
	"regexp"
	"strings"

	"github.com/sirupsen/logrus"

	"github.com/tidecanvas/tide-canvas-go/internal/model"
)

// ===== AiHandler 抽象 + 注册表（对齐 service/ai/AiHandler + AiHandlerRegistry）=====

// handlerResult 一次生成的结果（对齐 AiHandlerResult）。
type handlerResult struct {
	Success    bool
	ResultURL  string
	ResultMeta string
	ErrorMsg   string
}

func okResult(resultURL string) handlerResult {
	return handlerResult{Success: true, ResultURL: resultURL}
}
func failResult(msg string) handlerResult { return handlerResult{Success: false, ErrorMsg: msg} }

// aiHandler 单一生成方式的处理器（对齐 AiHandler）。
type aiHandler interface {
	// name handler 标识（text_to_image / image_to_image / ...）。
	name() string
	// validate 校验入参，非法返回 error（对齐 IllegalArgumentException → BadRequest）。
	validate(input map[string]interface{}) error
	// execute 执行生成（同步阻塞，内部可轮询上游）。
	execute(modelID string, input map[string]interface{}, pr progressReporter, ctx logCtx) handlerResult
	// async 是否异步（true → service 用 goroutine 跑；false → 同步执行，如 creative_desc）。
	async() bool
}

// handlerRegistry handler 名 → 实现（对齐 AiHandlerRegistry）。
type handlerRegistry struct {
	m map[string]aiHandler
}

// newHandlerRegistry 注册全部内置 handler（共用 gateway / logger）。
func newHandlerRegistry(gw *Gateway, logger *logrus.Logger) *handlerRegistry {
	r := &handlerRegistry{m: make(map[string]aiHandler)}
	for _, h := range []aiHandler{
		&textToImageHandler{gw: gw, logger: logger},
		&imageToImageHandler{gw: gw, logger: logger},
		&textToVideoHandler{gw: gw, logger: logger},
		&imageToVideoHandler{gw: gw, logger: logger},
		&startEndToVideoHandler{gw: gw, logger: logger},
		&referenceToVideoHandler{gw: gw, logger: logger},
		&textToAudioHandler{gw: gw, logger: logger},
		&assistantChatHandler{gw: gw, logger: logger},
		&creativeDescHandler{logger: logger},
	} {
		r.m[h.name()] = h
	}
	return r
}

// get 取 handler，不存在返回 (nil, false)（service 转 ecode.HandlerNotFound）。
func (r *handlerRegistry) get(name string) (aiHandler, bool) {
	h, ok := r.m[name]
	return h, ok
}

// ===== PromptRefUtils：提示词「图片N」内联引用归一化（对齐 service/ai/util/PromptRefUtils）=====

// inlineImageRefRe 内联图片引用标记：中文「图片N / 图N」或英文「{{Image N}}」。
var inlineImageRefRe = regexp.MustCompile(`(?:图片|图)\s*\d+|\{\{\s*[Ii]mage\s*\d+\s*}}`)

// chineseImageRefRe 中文「图片N / 图N」（带捕获组，用于替换）。
var chineseImageRefRe = regexp.MustCompile(`(?:图片|图)\s*(\d+)`)

// containsInlineImageRef prompt 是否已含内联引用。
func containsInlineImageRef(prompt string) bool {
	return prompt != "" && inlineImageRefRe.MatchString(prompt)
}

// normalizeInlineImageRefs 把中文「图片N / 图N」统一替换为「{{Image N}}」（已是 {{Image N}} 的保留）。
func normalizeInlineImageRefs(prompt string) string {
	if prompt == "" {
		return ""
	}
	return chineseImageRefRe.ReplaceAllString(prompt, "{{Image $1}}")
}

// ===== 公共校验辅助 =====

// requirePrompt 校验 input.prompt 非空白（多数 handler 复用）。
func requirePrompt(input map[string]interface{}) error {
	if !hasText(strOf(input["prompt"])) {
		return fmt.Errorf("prompt不能为空")
	}
	return nil
}

// requireField 校验某字段非空白。
func requireField(input map[string]interface{}, field, msg string) error {
	if !hasText(strOf(input[field])) {
		return fmt.Errorf("%s", msg)
	}
	return nil
}

// buildMultiResult 把图片 URL 列表封装为结果：首张作主结果 URL，多张时把全部写入 resultMeta.urls
// 供前端铺多个节点（对齐 TextToImageHandler/ImageToImageHandler.buildResult）。
func buildMultiResult(urls []string, input map[string]interface{}) handlerResult {
	if len(urls) == 0 {
		return failResult("未返回任何图片")
	}
	r := okResult(urls[0])
	r.ResultMeta = jsonString(map[string]interface{}{"urls": urls, "input": input})
	return r
}

// providerUsable 解析供应商并判断可用；返回 (provider, usable, err)。
func providerUsable(gw *Gateway, modelID string) (*model.AiProvider, bool, error) {
	p, err := gw.resolveProvider(modelID)
	if err != nil {
		return nil, false, err
	}
	return p, gw.isUsable(p), nil
}

// =====================================================================
// 各 Handler 实现（忠实迁移 service/ai/handler/*）
// =====================================================================

// ---- 文生图 ----
type textToImageHandler struct {
	gw     *Gateway
	logger *logrus.Logger
}

func (h *textToImageHandler) name() string { return "text_to_image" }
func (h *textToImageHandler) async() bool  { return true }
func (h *textToImageHandler) validate(input map[string]interface{}) error {
	return requirePrompt(input)
}
func (h *textToImageHandler) execute(modelID string, input map[string]interface{}, pr progressReporter, ctx logCtx) handlerResult {
	prompt := strOf(input["prompt"])
	provider, usable, err := providerUsable(h.gw, modelID)
	if err != nil {
		return failResult("图像生成失败: " + err.Error())
	}
	if !usable {
		warn(h.logger, "未配置可用的 AI 供应商（baseUrl/apiKey），返回占位图")
		return okResult(placeholderImage)
	}
	urls, err := h.gw.generate(provider, modelID, prompt, input, pr, ctx)
	if err != nil {
		logErr(h.logger, "文生图调用失败", err)
		return failResult("图像生成失败: " + err.Error())
	}
	return buildMultiResult(urls, input)
}

// ---- 图生图 ----
type imageToImageHandler struct {
	gw     *Gateway
	logger *logrus.Logger
}

func (h *imageToImageHandler) name() string { return "image_to_image" }
func (h *imageToImageHandler) async() bool  { return true }
func (h *imageToImageHandler) validate(input map[string]interface{}) error {
	if err := requirePrompt(input); err != nil {
		return err
	}
	return requireField(input, "sourceImage", "sourceImage不能为空")
}
func (h *imageToImageHandler) execute(modelID string, input map[string]interface{}, pr progressReporter, ctx logCtx) handlerResult {
	prompt := strOf(input["prompt"])
	sourceImage := strOf(input["sourceImage"])
	if !hasText(sourceImage) {
		return failResult("缺少源图片，请先上传图片或从上游节点连接")
	}

	// 优先使用前端传入的 imageList 原顺序（与 LibTV 调用一致：Image 1 = 第一张输入图，Image 2/3... = 参考图）。
	allURLs := collectImageList(input["imageList"])
	if len(allURLs) == 0 {
		allURLs = append(allURLs, sourceImage)
		for _, url := range collectImageList(input["references"]) {
			if len(allURLs) < maxEditImageURLs && !contains(allURLs, url) {
				allURLs = append(allURLs, url)
			}
		}
	}
	// 多图时标注每张图角色：尊重用户已在 prompt 内联绑定的编号，否则补「{{Image N}} is ...」整体说明。
	if len(allURLs) > 1 {
		if containsInlineImageRef(prompt) {
			prompt = normalizeInlineImageRefs(prompt)
		} else {
			var sb strings.Builder
			sb.WriteString("{{Image 1}} is the primary storyboard/composition reference")
			for i := 1; i < len(allURLs); i++ {
				sb.WriteString(fmt.Sprintf("; {{Image %d}} is reference image %d", i+1, i+1))
			}
			sb.WriteString(". ")
			sb.WriteString(prompt)
			prompt = sb.String()
		}
	}

	provider, usable, err := providerUsable(h.gw, modelID)
	if err != nil {
		return failResult("图像编辑失败: " + err.Error())
	}
	if !usable {
		warn(h.logger, "未配置可用的 AI 供应商（baseUrl/apiKey），返回占位图")
		return okResult(placeholderImage)
	}
	urls, err := h.gw.edit(provider, modelID, prompt, allURLs, input, pr, ctx)
	if err != nil {
		logErr(h.logger, "图生图调用失败", err)
		return failResult("图像编辑失败: " + err.Error())
	}
	return buildMultiResult(urls, input)
}

// collectImageList 从 input 的某个 List 字段收集去重 URL（限量），对齐 ImageToImageHandler.collectImageList。
func collectImageList(value interface{}) []string {
	return collectURLList(value, maxEditImageURLs)
}

// ---- 文生视频 ----
type textToVideoHandler struct {
	gw     *Gateway
	logger *logrus.Logger
}

func (h *textToVideoHandler) name() string { return "text_to_video" }
func (h *textToVideoHandler) async() bool  { return true }
func (h *textToVideoHandler) validate(input map[string]interface{}) error {
	return requirePrompt(input)
}
func (h *textToVideoHandler) execute(modelID string, input map[string]interface{}, pr progressReporter, ctx logCtx) handlerResult {
	return videoExec(h.gw, h.logger, modelID, input, "t2v", pr, ctx)
}

// ---- 图生视频 ----
type imageToVideoHandler struct {
	gw     *Gateway
	logger *logrus.Logger
}

func (h *imageToVideoHandler) name() string { return "image_to_video" }
func (h *imageToVideoHandler) async() bool  { return true }
func (h *imageToVideoHandler) validate(input map[string]interface{}) error {
	if err := requirePrompt(input); err != nil {
		return err
	}
	return requireField(input, "sourceImage", "sourceImage不能为空")
}
func (h *imageToVideoHandler) execute(modelID string, input map[string]interface{}, pr progressReporter, ctx logCtx) handlerResult {
	return videoExec(h.gw, h.logger, modelID, input, "i2v", pr, ctx)
}

// ---- 首尾帧视频 ----
type startEndToVideoHandler struct {
	gw     *Gateway
	logger *logrus.Logger
}

func (h *startEndToVideoHandler) name() string { return "start_end_to_video" }
func (h *startEndToVideoHandler) async() bool  { return true }
func (h *startEndToVideoHandler) validate(input map[string]interface{}) error {
	if err := requirePrompt(input); err != nil {
		return err
	}
	if err := requireField(input, "firstFrame", "firstFrame不能为空"); err != nil {
		return err
	}
	return requireField(input, "lastFrame", "lastFrame不能为空")
}
func (h *startEndToVideoHandler) execute(modelID string, input map[string]interface{}, pr progressReporter, ctx logCtx) handlerResult {
	return videoExec(h.gw, h.logger, modelID, input, "keyframe", pr, ctx)
}

// ---- 参考生视频 ----
type referenceToVideoHandler struct {
	gw     *Gateway
	logger *logrus.Logger
}

func (h *referenceToVideoHandler) name() string { return "reference_to_video" }
func (h *referenceToVideoHandler) async() bool  { return true }
func (h *referenceToVideoHandler) validate(input map[string]interface{}) error {
	if err := requirePrompt(input); err != nil {
		return err
	}
	hasImageRef := nonEmptyList(input["references"])
	hasVideoRef := nonEmptyList(input["videoReferences"])
	if !hasImageRef && !hasVideoRef {
		return fmt.Errorf("至少需要连接一个参考图片/视频")
	}
	return nil
}
func (h *referenceToVideoHandler) execute(modelID string, input map[string]interface{}, pr progressReporter, ctx logCtx) handlerResult {
	return videoExec(h.gw, h.logger, modelID, input, "omni_ref", pr, ctx)
}

// videoExec 视频 handler 公共执行：归一 prompt → 解析供应商 → 占位/调用网关（对齐各视频 Handler.execute）。
func videoExec(gw *Gateway, logger *logrus.Logger, modelID string, input map[string]interface{}, mode string, pr progressReporter, ctx logCtx) handlerResult {
	prompt := normalizeInlineImageRefs(strOf(input["prompt"]))
	provider, usable, err := providerUsable(gw, modelID)
	if err != nil {
		return failResult("视频生成失败: " + err.Error())
	}
	if !usable {
		warn(logger, "未配置可用的 AI 供应商（baseUrl/apiKey），返回占位视频")
		return okResult(placeholderImage)
	}
	url, err := gw.generateVideo(provider, modelID, prompt, input, mode, pr, ctx)
	if err != nil {
		logErr(logger, "视频调用失败", err)
		return failResult("视频生成失败: " + err.Error())
	}
	return okResult(url)
}

// ---- 文本转语音 ----
type textToAudioHandler struct {
	gw     *Gateway
	logger *logrus.Logger
}

// maxTTSTextLength TTS 文本上限（与 Runware MiniMax 等模型一致）。
const maxTTSTextLength = 50000

func (h *textToAudioHandler) name() string { return "text_to_audio" }
func (h *textToAudioHandler) async() bool  { return true }
func (h *textToAudioHandler) validate(input map[string]interface{}) error {
	prompt := strOf(input["prompt"])
	if !hasText(prompt) {
		return fmt.Errorf("prompt不能为空")
	}
	if len(prompt) > maxTTSTextLength {
		return fmt.Errorf("合成文本超长，最多 %d 字符", maxTTSTextLength)
	}
	return nil
}
func (h *textToAudioHandler) execute(modelID string, input map[string]interface{}, pr progressReporter, ctx logCtx) handlerResult {
	text := strOf(input["prompt"])
	provider, usable, err := providerUsable(h.gw, modelID)
	if err != nil {
		return failResult("语音合成失败: " + err.Error())
	}
	if !usable {
		return failResult("未配置可用的 AI 供应商（baseUrl/apiKey）")
	}
	url, err := h.gw.generateAudio(provider, modelID, text, input, pr, ctx)
	if err != nil {
		logErr(h.logger, "语音合成调用失败", err)
		return failResult("语音合成失败: " + err.Error())
	}
	return okResult(url)
}

// ---- 助手对话 ----
type assistantChatHandler struct {
	gw     *Gateway
	logger *logrus.Logger
}

func (h *assistantChatHandler) name() string { return "assistant_chat" }
func (h *assistantChatHandler) async() bool  { return false }
func (h *assistantChatHandler) validate(input map[string]interface{}) error {
	return requirePrompt(input)
}
func (h *assistantChatHandler) execute(modelID string, input map[string]interface{}, _ progressReporter, ctx logCtx) handlerResult {
	provider, usable, err := providerUsable(h.gw, modelID)
	if err != nil {
		return failResult("助手对话失败: " + err.Error())
	}
	if !usable {
		return failResult("未配置可用的 AI 供应商（baseUrl/apiKey）")
	}
	answer, err := h.gw.chat(provider, modelID, input, ctx)
	if err != nil {
		logErr(h.logger, "助手对话调用失败", err)
		return failResult("助手对话失败: " + err.Error())
	}
	r := okResult("")
	r.ResultMeta = jsonString(map[string]interface{}{"answer": answer})
	return r
}

// ---- 创意描述（同步占位实现，对齐 CreativeDescHandler）----
type creativeDescHandler struct {
	logger *logrus.Logger
}

func (h *creativeDescHandler) name() string { return "creative_desc" }
func (h *creativeDescHandler) async() bool  { return false }
func (h *creativeDescHandler) validate(input map[string]interface{}) error {
	return requirePrompt(input)
}
func (h *creativeDescHandler) execute(modelID string, input map[string]interface{}, _ progressReporter, _ logCtx) handlerResult {
	if h.logger != nil {
		h.logger.Infof("CreativeDesc handler executing: model=%s, prompt=%v", modelID, input["prompt"])
	}
	r := okResult("")
	// 占位：忠实迁移旧实现（TODO: 接入真实文本增强模型）
	r.ResultMeta = jsonString(map[string]interface{}{
		"enhancedPrompt": "AI enhanced version of: " + strOf(input["prompt"]),
	})
	return r
}

// nonEmptyList input 字段是否为非空数组。
func nonEmptyList(v interface{}) bool {
	list, ok := v.([]interface{})
	return ok && len(list) > 0
}

func warn(logger *logrus.Logger, msg string) {
	if logger != nil {
		logger.Warn(msg)
	}
}

func logErr(logger *logrus.Logger, msg string, err error) {
	if logger != nil {
		logger.Errorf("%s: %v", msg, err)
	}
}
