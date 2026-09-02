package ai

import (
	"errors"
	"strings"
	"testing"
	"time"

	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/relaymedia"
)

func resetErrorHintCacheForTest() {
	errorHintCache.mu.Lock()
	defer errorHintCache.mu.Unlock()
	errorHintCache.snapshot = nil
	errorHintCache.db = nil
	errorHintCache.loadedAt = time.Time{}
	errorHintCache.refreshing = false
}

func setErrorHintSnapshotForTest(snap *errorHintSnapshot) {
	errorHintCache.mu.Lock()
	defer errorHintCache.mu.Unlock()
	errorHintCache.snapshot = snap
	errorHintCache.loadedAt = time.Now()
}

func testHintSnapshot(t *testing.T) *errorHintSnapshot {
	t.Helper()
	// 规则挂在 market_models 行上(模型管理的落点);运行时任务/日志里的标识
	// 是 marketToAiModel 适配后的 ID / ModelKey / Name。
	models := []model.MarketModel{
		{
			BaseModel: model.BaseModel{ID: 101},
			Name:      "即梦视频 2.0", ModelKey: "jimeng-video-seedance-2.0-fast-vip-Dimensio", Type: "video",
			Config: `{"refLimits":{"omniRef.imageCount":9},"errorHints":[
				{"contains":"reference images for multi_ref","message":"该模型最多支持 9 张参考图，请减少后重试"},
				{"contains":"", "message":"孤儿文案(无匹配片段,应被丢弃)"},
				{"contains":"no message", "message":"  "}
			]}`,
		},
		{BaseModel: model.BaseModel{ID: 102}, Name: "Basic Image", ModelKey: "basic-image", Type: "image"},
	}
	global := `[
		{"contains":"video duration cap","message":"视频时长超出平台上限，请缩短后重试","modelType":"video"},
		{"contains":"maintenance window","message":"供应商维护中，请稍后重试"}
	]`
	snap := buildErrorHintSnapshot(models, global)
	if snap == nil {
		t.Fatal("snapshot is nil")
	}
	return snap
}

func TestErrorHintSnapshotScopesRulesByModelAndType(t *testing.T) {
	snap := testHintSnapshot(t)

	// 模型级规则:三种标识(数字 id / 上游 key / 显示名)都要命中同一份规则。
	raw := "relaymedia: model 'x' accepts at most 9 reference images for multi_ref, got 15"
	for _, ref := range []string{"101", "jimeng-video-seedance-2.0-fast-vip-Dimensio", "即梦视频 2.0"} {
		got, ok := snap.match(raw, ref)
		if !ok || got != "该模型最多支持 9 张参考图，请减少后重试" {
			t.Fatalf("ref %q: got %q, %v", ref, got, ok)
		}
	}
	// 空 contains / 空 message 的残缺规则必须被丢弃,不得吞掉全部错误。
	if got, ok := snap.match("unrelated failure", "101"); ok {
		t.Fatalf("malformed hints must be dropped, matched %q", got)
	}

	// 类型级全局规则:video 命中,image 不命中。
	if got, ok := snap.match("upstream video duration cap exceeded", "101"); !ok || got != "视频时长超出平台上限，请缩短后重试" {
		t.Fatalf("video-typed global rule: got %q, %v", got, ok)
	}
	if _, ok := snap.match("upstream video duration cap exceeded", "basic-image"); ok {
		t.Fatal("video-typed rule must not apply to an image model")
	}

	// 无类型全局规则:所有模型命中,包括快照里不认识的模型。
	for _, ref := range []string{"basic-image", "unknown-model"} {
		if got, ok := snap.match("upstream maintenance window", ref); !ok || got != "供应商维护中，请稍后重试" {
			t.Fatalf("global rule for ref %q: got %q, %v", ref, got, ok)
		}
	}
}

func TestErrorHintSnapshotIgnoresBrokenGlobalJSONButKeepsModelRules(t *testing.T) {
	snap := buildErrorHintSnapshot([]model.MarketModel{{
		BaseModel: model.BaseModel{ID: 1},
		Name:      "M", ModelKey: "m-key", Type: "video",
		Config: `{"errorHints":[{"contains":"boom","message":"自定义文案"}]}`,
	}}, `[{"contains":"broken`)
	if got, ok := snap.match("upstream boom", "m-key"); !ok || got != "自定义文案" {
		t.Fatalf("model rule lost with broken global JSON: %q, %v", got, ok)
	}
	if _, ok := snap.match("broken", "m-key"); ok {
		t.Fatal("broken global JSON must be ignored entirely")
	}
}

func TestScopedFailureReasonPrefersAdminHintsAndKeepsStoredCopy(t *testing.T) {
	snap := testHintSnapshot(t)
	raw := "relaymedia: model 'jimeng-video-seedance-2.0-fast-vip-Dimensio' accepts at most 9 reference images for multi_ref, got 15"

	// 自定义规则优先于内置关键词表(内置会给通用的「参考素材数量超过…」)。
	if got := publicGenerationFailureReasonScoped(snap, raw, "即梦视频 2.0"); got != "该模型最多支持 9 张参考图，请减少后重试" {
		t.Fatalf("admin hint must win over built-in rules, got %q", got)
	}
	// 无模型标识时退回内置分类,且原文(供应商后缀模型名)绝不透出。
	if got := publicGenerationFailureReasonScoped(snap, raw); got != "参考素材数量超过当前模型上限，请减少后重试" {
		t.Fatalf("unscoped fallback = %q", got)
	}
	// 存量行保存的自定义文案要通过白名单原样放行,不得被打回系统异常。
	if got := publicGenerationFailureReasonScoped(snap, "该模型最多支持 9 张参考图，请减少后重试"); got != "该模型最多支持 9 张参考图，请减少后重试" {
		t.Fatalf("stored custom copy must pass allowlist, got %q", got)
	}
	// nil 快照(缓存未加载)下全部退回内置行为。
	if got := publicGenerationFailureReasonScoped(nil, "provider 400: content policy violation"); got != userFacingSafetyErr {
		t.Fatalf("nil snapshot fallback = %q", got)
	}
	if got := publicGenerationFailureReasonScoped(nil, "totally novel provider failure"); got != userFacingGenErr {
		t.Fatalf("nil snapshot fail-closed = %q", got)
	}
}

func TestUserFacingGenErrorForModelAppliesHintsBeforeBusinessCodes(t *testing.T) {
	resetErrorHintCacheForTest()
	defer resetErrorHintCacheForTest()
	setErrorHintSnapshotForTest(buildErrorHintSnapshot([]model.MarketModel{{
		BaseModel: model.BaseModel{ID: 7},
		Name:      "M", ModelKey: "m-key", Type: "image",
		Config: `{"errorHints":[{"contains":"image_unsafe","message":"生成内容被上游拒绝，请调整提示词后重试"}]}`,
	}}, ""))

	// 运行时的 m 是 marketToAiModel 的适配结果:ID=市场行ID,ModelID=ModelKey。
	m := &model.AiModel{ID: 7, Name: "M", ModelID: "m-key"}
	// 5002 本会命中业务码映射,但该模型的自定义规则要更优先。
	err := &relaymedia.UpstreamError{Code: "5002", Message: "400 image_unsafe: rejected"}
	if got := userFacingGenErrorForModel(nil, m, err); got != "生成内容被上游拒绝，请调整提示词后重试" {
		t.Fatalf("hint must override business code, got %q", got)
	}
	// 未命中规则时退回内置分类。
	if got := userFacingGenErrorForModel(nil, m, errors.New("prompt is too long")); got != "提示词过长，请精简后重试" {
		t.Fatalf("built-in fallback = %q", got)
	}
	if got := userFacingGenErrorForModel(nil, nil, errors.New("whatever")); got != userFacingGenErr {
		t.Fatalf("nil model fail-closed = %q", got)
	}
}

// 快照被所有分类路径并发共享:hintsFor 组合模型/类型/全局规则时必须组装全新
// 切片,append 到缓存共享切片会写坏底层数组(-race 下必报)。
func TestErrorHintSnapshotIsSafeForConcurrentMatch(t *testing.T) {
	snap := testHintSnapshot(t)
	done := make(chan struct{})
	for g := 0; g < 8; g++ {
		go func() {
			defer func() { done <- struct{}{} }()
			for i := 0; i < 500; i++ {
				if got, ok := snap.match("upstream boom reference images for multi_ref", "101"); !ok || got != "该模型最多支持 9 张参考图，请减少后重试" {
					t.Errorf("model hint lost under concurrency: %q, %v", got, ok)
					return
				}
				if got, ok := snap.match("upstream video duration cap", "即梦视频 2.0"); !ok || got != "视频时长超出平台上限，请缩短后重试" {
					t.Errorf("type hint lost under concurrency: %q, %v", got, ok)
					return
				}
			}
		}()
	}
	for g := 0; g < 8; g++ {
		<-done
	}
}

// 公开模型目录不得透出 errorHints:匹配片段常含供应商后缀的模型名。
func TestPublicModelConfigStripsErrorHints(t *testing.T) {
	m := &model.AiModel{
		ID: 1, Name: "M", Type: "video",
		Config: `{"refLimits":{"omniRef.imageCount":9},"hideBatchCount":true,"availabilityStatus":"maintenance","errorHints":[{"contains":"vip-Dimensio","message":"文案"}]}`,
	}
	vo := toModelVO(m)
	if strings.Contains(vo.Config, "errorHints") || strings.Contains(vo.Config, "Dimensio") {
		t.Fatalf("public config leaked errorHints: %s", vo.Config)
	}
	if !strings.Contains(vo.Config, "refLimits") {
		t.Fatalf("public config lost unrelated keys: %s", vo.Config)
	}
	if !strings.Contains(vo.Config, `"hideBatchCount":true`) {
		t.Fatalf("public config lost batch count visibility: %s", vo.Config)
	}
	if !strings.Contains(vo.Config, `"availabilityStatus":"maintenance"`) {
		t.Fatalf("public config lost availability status: %s", vo.Config)
	}
	// 无 errorHints 的配置原样透传(包括非对象/空串),不做无谓的重排。
	for _, raw := range []string{"", "not-json", `{"modes":["t2v"]}`} {
		if got := publicModelConfigJSON(raw); got != raw {
			t.Fatalf("config %q rewritten to %q", raw, got)
		}
	}
}

func TestParseErrorHintsCapsCountAndMessageLength(t *testing.T) {
	long := strings.Repeat("超", 2000)
	hints := parseErrorHints(`[{"contains":"a","message":"`+long+`"}]`, maxErrorHintsPerModel)
	if len(hints) != 1 || len([]rune(hints[0].Message)) > 1024 {
		t.Fatalf("message not truncated: len=%d", len([]rune(hints[0].Message)))
	}
	many := "["
	for i := 0; i < 50; i++ {
		if i > 0 {
			many += ","
		}
		many += `{"contains":"c","message":"m"}`
	}
	many += "]"
	if got := len(parseErrorHints(many, maxErrorHintsPerModel)); got != maxErrorHintsPerModel {
		t.Fatalf("count cap = %d, want %d", got, maxErrorHintsPerModel)
	}
}
