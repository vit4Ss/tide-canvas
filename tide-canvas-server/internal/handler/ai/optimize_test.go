package ai

import (
	"errors"
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
