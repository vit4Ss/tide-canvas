package ai

import (
	"strings"
	"testing"
)

// 作品登记与技能拼接的纯函数部分。需要库的分支（applySkill 查技能）在 service
// 层跑，这里锁住不依赖 DB 的口径。

func TestWorkTypeOf(t *testing.T) {
	cases := map[string]string{
		"generation": "image",
		"edits":      "image",
		"video":      "video",
		"audio":      "audio",
		"chat":       "", // 文本对话没有可展示的产出，不登记为作品
		"":           "",
	}
	for op, want := range cases {
		if got := workTypeOf(op); got != want {
			t.Errorf("workTypeOf(%q) = %q, want %q", op, got, want)
		}
	}
}

func TestWorkTitle(t *testing.T) {
	// 取首行
	if got := workTitle("第一行\n第二行", "M"); got != "第一行" {
		t.Errorf("multiline title = %q, want 第一行", got)
	}
	// 空描述回落模型名，列表里不出现无题行
	if got := workTitle("   ", "GPT Image 2"); got != "GPT Image 2" {
		t.Errorf("empty prompt title = %q, want the model name", got)
	}
	// 按 rune 截断：按字节切会把中文切成半个字，落库变乱码
	long := strings.Repeat("中", 60)
	got := workTitle(long, "M")
	if !strings.HasSuffix(got, "…") {
		t.Errorf("long title should be elided, got %q", got)
	}
	if r := []rune(got); len(r) != 41 { // 40 + 省略号
		t.Errorf("title rune count = %d, want 41", len(r))
	}
	if strings.Contains(got, "�") {
		t.Error("title was cut mid-rune")
	}
}

// skillId 绝不能透给上游：它是我们自己的字段，转发过去轻则被忽略、重则被判非法参数。
func TestApplySkillAlwaysStripsSkillID(t *testing.T) {
	s := &service{} // 没有 repo：查库分支必然走不通，正好验证「查不到也要删键」
	in := map[string]any{"prompt": "一只猫", "skillId": "not-a-real-id"}

	out := s.applySkill(in, genHandler{name: "text_to_image", op: "generation"})

	if _, ok := out["skillId"]; ok {
		t.Error("skillId leaked into the upstream input")
	}
	// 技能不可用时按「没带技能」处理：提示词保持用户原文，不能因此挡住生成
	if out["prompt"] != "一只猫" {
		t.Errorf("prompt = %v, want the untouched user text", out["prompt"])
	}
}

func TestSkillOutputTypeIncludesTextHandlers(t *testing.T) {
	for _, name := range []string{assistantChatHandler, skillTextCompletionHandler} {
		got := skillOutputTypeOf(genHandler{name: name, op: "chat", isAsync: true})
		if got != "text" {
			t.Fatalf("%s skill output type = %q, want text", name, got)
		}
	}
}

// 模板拼接口径：模板在前、空行分隔；描述为空只发模板。
func TestApplyPromptTemplate(t *testing.T) {
	got := applyPromptTemplate(map[string]any{"prompt": "一只猫"}, "电影级画面质感")
	if got["prompt"] != "电影级画面质感\n\n一只猫" {
		t.Errorf("merged prompt = %q", got["prompt"])
	}

	got = applyPromptTemplate(map[string]any{"prompt": "   "}, "电影级画面质感")
	if got["prompt"] != "电影级画面质感" {
		t.Errorf("empty description should send the template alone, got %q", got["prompt"])
	}
}

// 音乐的自定义歌词/延长/翻唱模式刻意不发 prompt（上游有 lyrics 时忽略描述）。
// 技能不能给这类请求凭空造一个 prompt 出来。
func TestApplyPromptTemplateNeverCreatesPrompt(t *testing.T) {
	in := map[string]any{"lyrics": "第一句歌词", "tags": "lofi"}
	got := applyPromptTemplate(in, "热血动漫主题曲风格")
	if _, ok := got["prompt"]; ok {
		t.Errorf("template was injected into a promptless request: %v", got["prompt"])
	}
	if got["lyrics"] != "第一句歌词" {
		t.Error("other fields must be untouched")
	}
}

func TestValidateGenerationPromptSize(t *testing.T) {
	if err := validateGenerationPromptSize(map[string]any{"prompt": strings.Repeat("x", maxRenderedSkillPromptBytes)}); err != nil {
		t.Fatal(err)
	}
	if err := validateGenerationPromptSize(map[string]any{"systemPrompt": strings.Repeat("x", maxRenderedSkillPromptBytes+1)}); err == nil {
		t.Fatal("oversized rendered prompt was accepted")
	}
}

func TestApplySkillNilInput(t *testing.T) {
	s := &service{}
	if out := s.applySkill(nil, genHandler{name: "text_to_image", op: "generation"}); out != nil {
		t.Errorf("nil input should pass through, got %v", out)
	}
}
