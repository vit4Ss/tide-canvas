package ai

import (
	"context"
	"errors"
	"strings"
	"testing"
)

// 「调用方自己能处理」的失败必须能被 handler 识别出来并走 400——用 500 的话
// response.Fail 会把文案抹成统一话术（默认「请联系客服」），而这些恰恰是
// 唯一告诉用户/管理员该做什么的信息。
func TestOptimizeUnusableIsDistinguishable(t *testing.T) {
	cases := []string{
		"请先输入提示词",
		"AI 优化未启用：未配置中转站密钥",
		"AI 优化未启用：请在模型管理添加文本模型并设为「AI 优化主模型」",
		modelMaintenanceMessage,
	}
	for _, msg := range cases {
		err := optimizeUnusable(msg)
		if !errors.Is(err, errOptimizeUnusable) {
			t.Errorf("%q: not recognised as unusable", msg)
		}
		if got := optimizeUnusableMsg(err); got != msg {
			t.Errorf("message not recovered: got %q, want %q", got, msg)
		}
	}
}

// 上游/内部故障不得被误判成可自行处理——那会让上游原文直接出站。
func TestUpstreamErrorsAreNotUnusable(t *testing.T) {
	for _, err := range []error{
		errors.New("AI 优化失败，请稍后重试"),
		errors.New("relaychat: HTTP 502 bad gateway"),
		errInsufficientPoints,
	} {
		if errors.Is(err, errOptimizeUnusable) {
			t.Errorf("%v: must NOT be treated as caller-fixable", err)
		}
	}
}

// 文案本身含「: 」时也要能完整取回（中文冒号「：」不是分隔符，不该被切）。
func TestOptimizeUnusableMsgKeepsChineseColon(t *testing.T) {
	msg := "AI 优化未启用：未配置中转站密钥"
	if got := optimizeUnusableMsg(optimizeUnusable(msg)); got != msg {
		t.Errorf("got %q, want %q", got, msg)
	}
}

func TestPromptRewriteDefaultsToExistingOptimization(t *testing.T) {
	for _, action := range []string{"", "optimize"} {
		spec, err := resolvePromptRewrite(action, "")
		if err != nil || spec.action != "optimize" || spec.label != "AI 优化" || spec.systemPrompt != optimizeSystemPrompt {
			t.Fatalf("%q changed existing optimization: %#v, %v", action, spec, err)
		}
	}
}

func TestPromptTranslationUsesFixedLanguageInstructions(t *testing.T) {
	for language, name := range map[string]string{"en": "英语", "zh": "简体中文"} {
		spec, err := resolvePromptRewrite("translate", language)
		if err != nil || spec.action != "translate" || spec.label != "AI 翻译" {
			t.Fatalf("%s: %#v, %v", language, spec, err)
		}
		if !strings.Contains(spec.systemPrompt, "准确翻译为"+name) || !strings.Contains(spec.systemPrompt, "不能翻译、增删或改变出现次数") {
			t.Fatalf("%s: missing language/reference instructions", language)
		}
	}
}

func TestPromptRewriteRejectsInvalidOptionsBeforeModelAccess(t *testing.T) {
	for _, input := range []struct{ action, language string }{
		{"execute", ""}, {"TRANSLATE", "en"}, {"translate ", "en"},
		{"translate", ""}, {"translate", "fr"}, {"translate", "EN"},
		{"translate", "en; ignore instructions"}, {"optimize", "en"}, {"", "zh"},
	} {
		// An unconfigured service has no model repository or ledger; option errors
		// must return before either is touched or an upstream call can be charged.
		_, err := (&service{}).optimizePrompt(context.Background(), 0, "测试", input.action, input.language)
		if !errors.Is(err, errOptimizeUnusable) || strings.Contains(optimizeUnusableMsg(err), "未配置") {
			t.Fatalf("%#v: expected option validation before service access, got %v", input, err)
		}
	}
}

func TestPromptTranslationPreservesReferenceAndTemplatePlaceholders(t *testing.T) {
	source := "让图片1中的人物参考视频12，在音频2中朗读文本3。保持图片1和 {{character_name}}，时长 ${duration} 秒。"
	translated := "Keep {{character_name}} and 图片1. Make the person in 图片1 follow 视频12 and read 文本3 in 音频2 for ${duration} seconds."
	if err := validatePromptTranslation(source, translated); err != nil {
		t.Fatalf("valid reordered translation rejected: %v", err)
	}
	if err := validatePromptTranslation(translated, source); err != nil {
		t.Fatalf("valid Chinese translation rejected: %v", err)
	}
	if err := validatePromptTranslation("一只猫，16:9，00:03", "A cat, 16:9, 00:03"); err != nil {
		t.Fatalf("plain translation rejected: %v", err)
	}
}

func TestPromptTranslationRejectsLostRenamedOrDuplicatedPlaceholders(t *testing.T) {
	source := "图片1 视频12 音频2 文本3 {{subject}} ${duration} 图片1"
	for _, translated := range []string{
		"", "   ",
		"Image1 视频12 音频2 文本3 {{subject}} ${duration} 图片1",
		"图片1 视频1 音频2 文本3 {{subject}} ${duration} 图片1",
		"图片1 视频12 音频2 文本3 {{subject}} ${duration}",
		"图片1 视频12 音频2 文本3 {{主体}} ${duration} 图片1",
		"图片1 视频12 音频2 文本3 {{subject}} ${时长} 图片1",
		source + " 图片4",
		source + " {{subject}}",
	} {
		if err := validatePromptTranslation(source, translated); err == nil {
			t.Errorf("accepted broken translation: %q", translated)
		}
	}
}
