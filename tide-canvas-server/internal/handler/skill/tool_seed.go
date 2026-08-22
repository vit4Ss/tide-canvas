package skill

import (
	"crypto/sha256"
	"encoding/hex"
	"time"

	"gorm.io/gorm"

	"tidecanvas/internal/model"
)

type seedToolSkill struct {
	key, title, description, category, primaryOutput, inputSchema, manifest, instructions, defaultParams string
}

var baselineToolSkills = []seedToolSkill{
	{
		key: "tool-pptx", title: "生成 PPT", category: "办公文档", primaryOutput: "file",
		description:   "根据主题、受众和页数生成可编辑的 PowerPoint 演示文稿",
		inputSchema:   `{"type":"object","required":["prompt"],"properties":{"prompt":{"type":"string","title":"内容要求","description":"说明演示主题、重点与期望结构","minLength":2,"maxLength":8000,"x-ui-widget":"textarea"},"audience":{"type":"string","title":"目标受众","placeholder":"例如：管理层、客户、学生","default":"通用受众","maxLength":120},"pageCount":{"type":"integer","title":"页数","minimum":3,"maximum":30,"default":10},"fileName":{"type":"string","title":"文件名","placeholder":"留空将根据标题生成","maxLength":80}}}`,
		manifest:      `{"kind":"tool","steps":[{"key":"outline","title":"规划演示内容","type":"text","handler":"skill_text_completion","outputType":"text","outputRole":"intermediate","strictJson":true,"prompt":"请根据以下要求生成 PPT 数据。用户要求：{{prompt}}\n目标受众：{{input.audience}}\n页数：{{input.pageCount}}。只返回严格 JSON：{\"title\":\"演示标题\",\"slides\":[{\"title\":\"页面标题\",\"bullets\":[\"要点\"]}]}。slides 数量应与页数一致，每页 2-6 个要点，内容具体，不要输出代码围栏。"},{"key":"render","title":"生成 PPT 文件","type":"tool","handler":"render_pptx","outputType":"file","outputRole":"final","prompt":"{{previous}}"}]}`,
		instructions:  "你是资深演示文稿策划。先建立清晰叙事，再压缩为适合投影阅读的页面内容。避免空话、重复和大段正文；数据不确定时不得编造。",
		defaultParams: `{"audience":"通用受众","pageCount":10}`,
	},
	{
		key: "tool-xlsx", title: "生成 XLSX", category: "办公文档", primaryOutput: "file",
		description:  "把业务需求整理成包含表头与数据的可编辑 Excel 工作簿",
		inputSchema:  `{"type":"object","required":["prompt"],"properties":{"prompt":{"type":"string","title":"表格要求","description":"说明字段、数据、工作表和计算口径","minLength":2,"maxLength":12000,"x-ui-widget":"textarea"},"fileName":{"type":"string","title":"文件名","placeholder":"留空将根据标题生成","maxLength":80}}}`,
		manifest:     `{"kind":"tool","steps":[{"key":"structure","title":"整理表格数据","type":"text","handler":"skill_text_completion","outputType":"text","outputRole":"intermediate","strictJson":true,"prompt":"把用户要求整理成工作簿数据：{{prompt}}。只返回严格 JSON：{\"title\":\"工作簿标题\",\"sheets\":[{\"name\":\"工作表名\",\"rows\":[[\"表头1\",\"表头2\"],[\"数据1\",123]]}]}。每行列数保持一致，数字和布尔值使用 JSON 原生类型，不要输出代码围栏。"},{"key":"render","title":"生成 Excel 文件","type":"tool","handler":"render_xlsx","outputType":"file","outputRole":"final","prompt":"{{previous}}"}]}`,
		instructions: "你是严谨的数据整理专家。优先建立明确字段、单位和口径；不得虚构用户未提供的事实数据，必要时使用清晰的示例或空值。",
	},
	{
		key: "tool-docx", title: "生成 Word", category: "办公文档", primaryOutput: "file",
		description:   "根据要求生成结构完整、可继续编辑的 Word 文档",
		inputSchema:   `{"type":"object","required":["prompt"],"properties":{"prompt":{"type":"string","title":"文档要求","description":"说明主题、结构、篇幅和必须包含的信息","minLength":2,"maxLength":16000,"x-ui-widget":"textarea"},"audience":{"type":"string","title":"阅读对象","default":"通用读者","maxLength":120},"tone":{"type":"string","title":"语言风格","enum":["专业正式","简洁直接","说明教学","友好自然"],"default":"专业正式"},"fileName":{"type":"string","title":"文件名","placeholder":"留空将根据标题生成","maxLength":80}}}`,
		manifest:      `{"kind":"tool","steps":[{"key":"draft","title":"撰写文档","type":"text","handler":"skill_text_completion","outputType":"text","outputRole":"intermediate","strictJson":true,"prompt":"撰写 Word 文档。用户要求：{{prompt}}\n阅读对象：{{input.audience}}\n语言风格：{{input.tone}}。只返回严格 JSON：{\"title\":\"文档标题\",\"subtitle\":\"可选副标题\",\"sections\":[{\"heading\":\"章节标题\",\"paragraphs\":[\"完整段落\"],\"bullets\":[\"可选要点\"]}]}。内容必须完整、连贯，不要输出代码围栏。"},{"key":"render","title":"生成 Word 文件","type":"tool","handler":"render_docx","outputType":"file","outputRole":"final","prompt":"{{previous}}"}]}`,
		instructions:  "你是专业文档编辑。根据用户提供的信息写作，确保结构清楚、语言准确、前后一致；缺失的事实不要擅自补造。",
		defaultParams: `{"audience":"通用读者","tone":"专业正式"}`,
	},
	{
		key: "tool-markdown", title: "生成 Markdown", category: "办公文档", primaryOutput: "file",
		description:  "生成结构清晰、可下载和继续编辑的 Markdown 文档",
		inputSchema:  `{"type":"object","required":["prompt"],"properties":{"prompt":{"type":"string","title":"文档要求","description":"说明主题、结构和需要包含的内容","minLength":2,"maxLength":16000,"x-ui-widget":"textarea"},"fileName":{"type":"string","title":"文件名","placeholder":"留空默认生成文档.md","maxLength":80}}}`,
		manifest:     `{"kind":"tool","steps":[{"key":"write","title":"撰写 Markdown","type":"text","handler":"skill_text_completion","outputType":"text","outputRole":"intermediate","prompt":"请直接生成完整 Markdown 文档。用户要求：{{prompt}}。使用清晰的标题层级、短段落和必要列表；不要添加代码围栏包裹整篇内容。"},{"key":"render","title":"生成 Markdown 文件","type":"tool","handler":"render_markdown","outputType":"file","outputRole":"final","prompt":"{{previous}}"}]}`,
		instructions: "你是专业技术编辑。输出可直接使用的 Markdown 正文，结构自然克制，不添加无意义的总结或装饰。",
	},
	{
		key: "tool-video-analysis", title: "视频分析", category: "内容分析", primaryOutput: "text",
		description:  "提取视频音轨与关键帧，完成 ASR 转写、内容摘要和镜头分析",
		inputSchema:  `{"type":"object","x-asset-types":["video"],"required":["assets"],"properties":{"assets":{"type":"array","title":"视频文件","minItems":1,"maxItems":1},"prompt":{"type":"string","title":"分析重点","placeholder":"例如：完整转写并总结观点；分析镜头节奏和叙事结构","maxLength":4000,"x-ui-widget":"textarea"}}}`,
		manifest:     `{"kind":"tool","steps":[{"key":"analyze","title":"转写并分析视频","type":"tool","handler":"analyze_video","outputType":"text","outputRole":"final","prompt":"{{prompt}}"}]}`,
		instructions: "分析必须基于实际音轨和画面，不确定内容明确标注。",
	},
	{
		key: "tool-audio-analysis", title: "音频分析", category: "内容分析", primaryOutput: "text",
		description:  "完成音频 ASR 转写，并分析主题、说话人、情绪与行动项",
		inputSchema:  `{"type":"object","x-asset-types":["audio"],"required":["assets"],"properties":{"assets":{"type":"array","title":"音频文件","minItems":1,"maxItems":1},"prompt":{"type":"string","title":"分析重点","placeholder":"例如：逐字转写，并提取决策和待办事项","maxLength":4000,"x-ui-widget":"textarea"}}}`,
		manifest:     `{"kind":"tool","steps":[{"key":"analyze","title":"转写并分析音频","type":"tool","handler":"analyze_audio","outputType":"text","outputRole":"final","prompt":"{{prompt}}"}]}`,
		instructions: "分析必须忠实于音频，听不清内容使用明确标记，不得猜测补全。",
	},
	{
		key: "tool-web-analysis", title: "网页分析", category: "内容分析", primaryOutput: "text",
		description:  "读取公开网页正文，按指定重点进行摘要、提炼与结构化分析",
		inputSchema:  `{"type":"object","required":["url"],"properties":{"url":{"type":"string","title":"网页地址","format":"uri","pattern":"^https?://","placeholder":"https://example.com/article"},"prompt":{"type":"string","title":"分析重点","placeholder":"例如：总结核心观点并列出论据和风险","maxLength":4000,"x-ui-widget":"textarea"}}}`,
		manifest:     `{"kind":"tool","steps":[{"key":"analyze","title":"读取并分析网页","type":"tool","handler":"analyze_webpage","outputType":"text","outputRole":"final","prompt":"{{prompt}}"}]}`,
		instructions: "分析只基于抓取到的网页正文，区分原文事实与推断。",
	},
}

// ensureBaselineToolSkills only inserts a missing seed. Once an administrator
// edits, unpublishes or deletes it, boot-time seeding never overwrites/revives it.
func ensureBaselineToolSkills(db *gorm.DB) error {
	for index := range baselineToolSkills {
		definition := baselineToolSkills[index]
		var count int64
		if err := db.Unscoped().Model(&model.Skill{}).Where("seed_key = ?", definition.key).Count(&count).Error; err != nil {
			return err
		}
		if count > 0 {
			continue
		}
		if err := db.Transaction(func(tx *gorm.DB) error {
			now := time.Now()
			defaultParams := definition.defaultParams
			if defaultParams == "" {
				defaultParams = "{}"
			}
			skill := model.Skill{
				Title: definition.title, Description: definition.description, Category: definition.category,
				OutputType: definition.primaryOutput, PromptTemplate: definition.instructions,
				DefaultParams: defaultParams, AuthorName: "官方", SeedKey: definition.key, Status: 1,
				SortOrder: 100 + index, Kind: model.SkillKindTool,
			}
			if err := tx.Create(&skill).Error; err != nil {
				return err
			}
			bindings := `[{"surface":"studio","targetType":"*","enabled":true,"sortOrder":` + itoaSmall(index) + `,"defaults":{}}]`
			outputTypes := `["` + definition.primaryOutput + `"]`
			if definition.primaryOutput == "file" {
				outputTypes = `["text","file"]`
			}
			version := model.SkillVersion{
				SkillID: skill.ID, Version: 1, Kind: model.SkillKindTool, Status: model.SkillVersionPublished,
				EntryPoints: `["studio"]`, PrimaryOutputType: definition.primaryOutput,
				OutputTypes: outputTypes, InputSchema: definition.inputSchema,
				ManifestJSON: definition.manifest, PromptTemplate: definition.instructions, DefaultParams: defaultParams,
				BindingsJSON: bindings, PrimaryFilePath: "SKILL.md", PublishedAt: &now,
			}
			version.ContentHash = seedToolHash(definition.inputSchema, definition.manifest, definition.instructions, defaultParams, bindings)
			if err := tx.Create(&version).Error; err != nil {
				return err
			}
			fileHash := sha256.Sum256([]byte(definition.instructions))
			file := model.SkillFile{SkillVersionID: version.ID, Path: "SKILL.md", Content: definition.instructions,
				MimeType: "text/markdown; charset=utf-8", Size: int64(len([]byte(definition.instructions))), SHA256: hex.EncodeToString(fileHash[:])}
			if err := tx.Create(&file).Error; err != nil {
				return err
			}
			binding := model.SkillSurfaceBinding{SkillID: skill.ID, Surface: "studio", TargetType: "*", Enabled: true, SortOrder: index, Defaults: "{}"}
			if err := tx.Create(&binding).Error; err != nil {
				return err
			}
			return tx.Model(&model.Skill{}).Where("id = ?", skill.ID).Update("current_version_id", version.ID).Error
		}); err != nil {
			return err
		}
	}
	return nil
}

func seedToolHash(parts ...string) string {
	hash := sha256.New()
	for _, part := range parts {
		_, _ = hash.Write([]byte(part))
		_, _ = hash.Write([]byte{0})
	}
	return hex.EncodeToString(hash.Sum(nil))
}

func itoaSmall(value int) string {
	if value == 0 {
		return "0"
	}
	result := ""
	for value > 0 {
		result = string(rune('0'+value%10)) + result
		value /= 10
	}
	return result
}
