package ai

// 错误提示映射:管理员可为「某个模型」或「某类模型」把上游原始错误的固定片段
// 映射成自研的用户文案,免发版纠正「系统异常，请联系客服」兜底。规则来自两处:
//   - 模型管理:模型 Config JSON 的 errorHints 数组(按模型 id/上游 key/显示名命中)
//   - 配置管理:sys_config「ai.errorHints」全局数组(可选 modelType 过滤)
// 同一套规则作用于写入时(任务失败落库的 task.ErrorMsg)与回看时(管理端详情、
// 用户历史、画布历史的重分类),并把已配置的文案并入回看白名单,保证存量记录
// 不会被 fail-closed 打回系统异常。
//
// 匹配是小写包含(与内置 inputErrorRules 同机制),不支持正则与占位符——文案
// 必须是管理员手写的固定字符串,上游原文(供应商后缀模型名、内部地址)永不透传。

import (
	"context"
	"encoding/json"
	"strings"
	"sync"
	"time"

	"gorm.io/gorm"

	"tidecanvas/internal/model"
)

type errorHint struct {
	Contains string `json:"contains"`
	Message  string `json:"message"`
	// ModelType 仅全局规则使用:image|video|text|audio,空 = 所有模型。
	ModelType string `json:"modelType,omitempty"`
}

const (
	maxErrorHintsPerModel = 32
	maxGlobalErrorHints   = 128
	errorHintCacheTTL     = time.Minute
)

type errorHintSnapshot struct {
	// byRef 以模型的三种标识(数字 id / 上游 model key / 显示名,均小写)指向
	// 同一份规则:任务行存数字 id+显示名,生成日志存显示名,调用日志存上游 key。
	byRef  map[string][]errorHint
	typeOf map[string]string
	byType map[string][]errorHint
	global []errorHint
	// messages 是全部已配置文案的集合:存量行里保存的自定义文案靠它通过
	// PublicGenerationFailureReason 的白名单。
	messages map[string]struct{}
}

var errorHintCache struct {
	mu       sync.Mutex
	snapshot *errorHintSnapshot
	loadedAt time.Time
	// refreshing 单飞:TTL 到期后只有一个调用方去打库,其余立刻拿旧快照。
	// 查询绝不能在持锁状态下做——所有分类路径(任务轮询/历史列表)都要过这把
	// 锁,DB 一卡会拖挂整个出站链路。
	refreshing bool
	// db 记住最近一次传入的句柄,让 vo 映射层这类拿不到 db 的纯函数也能按
	// TTL 惰性刷新(newService 启动即注册)。
	db *gorm.DB
}

// errorHintsSnapshot returns the cached rule set, refreshing from the database
// at most once per TTL. Load failures keep the previous snapshot: error-copy
// mapping must never break the generation or history path itself.
func errorHintsSnapshot(db *gorm.DB) *errorHintSnapshot {
	errorHintCache.mu.Lock()
	if db != nil {
		errorHintCache.db = db
	} else {
		db = errorHintCache.db
	}
	snap := errorHintCache.snapshot
	fresh := snap != nil && time.Since(errorHintCache.loadedAt) < errorHintCacheTTL
	if fresh || db == nil || errorHintCache.refreshing {
		errorHintCache.mu.Unlock()
		return snap
	}
	errorHintCache.refreshing = true
	errorHintCache.mu.Unlock()

	next := loadErrorHintSnapshot(db)
	errorHintCache.mu.Lock()
	errorHintCache.refreshing = false
	if next != nil {
		errorHintCache.snapshot = next
	}
	// 失败同样推进时间戳:DB 故障期间沿用旧快照,等一个 TTL 再试,而不是
	// 每次分类都重试打库。
	errorHintCache.loadedAt = time.Now()
	snap = errorHintCache.snapshot
	errorHintCache.mu.Unlock()
	return snap
}

// loadErrorHintSnapshot fetches and parses the rules; nil on failure. The
// short deadline keeps a stuck database from stalling the classification
// paths that triggered the refresh.
//
// 规则必须从 market_models 读:模型管理编辑的是市场行,运行时也是
// marketToAiModel 适配市场行来生成(ai_models 只是只读的注册表,不是
// 管理员配置的落点)。
func loadErrorHintSnapshot(db *gorm.DB) *errorHintSnapshot {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	var rows []model.MarketModel
	if err := db.WithContext(ctx).Select("id", "model_key", "name", "type", "config").Find(&rows).Error; err != nil {
		return nil
	}
	globalJSON := ""
	var cfg model.SysConfig
	if err := db.WithContext(ctx).Where("config_key = ?", model.ConfigKeyAIErrorHints).First(&cfg).Error; err == nil {
		globalJSON = cfg.ConfigValue
	}
	return buildErrorHintSnapshot(rows, globalJSON)
}

// cachedErrorHintSnapshot serves read paths that have no db handle of their
// own; it still refreshes via the remembered handle once the TTL lapses.
func cachedErrorHintSnapshot() *errorHintSnapshot { return errorHintsSnapshot(nil) }

func buildErrorHintSnapshot(rows []model.MarketModel, globalJSON string) *errorHintSnapshot {
	snap := &errorHintSnapshot{
		byRef:    map[string][]errorHint{},
		typeOf:   map[string]string{},
		byType:   map[string][]errorHint{},
		messages: map[string]struct{}{},
	}
	for i := range rows {
		hints := parseErrorHints(modelConfigErrorHintsJSON(rows[i].Config), maxErrorHintsPerModel)
		modelType := strings.ToLower(strings.TrimSpace(rows[i].Type))
		// 三种标识与 marketToAiModel 的适配结果一一对应:任务行存 ID+Name,
		// 生成日志存 Name,模型调用日志存 ModelKey(适配后的 AiModel.ModelID)。
		for _, ref := range []string{rows[i].ID.String(), rows[i].ModelKey, rows[i].Name} {
			key := strings.ToLower(strings.TrimSpace(ref))
			if key == "" {
				continue
			}
			if len(hints) > 0 {
				snap.byRef[key] = hints
			}
			if modelType != "" {
				snap.typeOf[key] = modelType
			}
		}
		for _, h := range hints {
			snap.messages[h.Message] = struct{}{}
		}
	}
	for _, h := range parseErrorHints(globalJSON, maxGlobalErrorHints) {
		if t := strings.ToLower(strings.TrimSpace(h.ModelType)); t != "" {
			snap.byType[t] = append(snap.byType[t], h)
		} else {
			snap.global = append(snap.global, h)
		}
		snap.messages[h.Message] = struct{}{}
	}
	return snap
}

// modelConfigErrorHintsJSON extracts the raw errorHints array from a model's
// Config JSON so parseErrorHints can share one sanitizer with the global rules.
func modelConfigErrorHintsJSON(configJSON string) string {
	if strings.TrimSpace(configJSON) == "" {
		return ""
	}
	var cfg struct {
		ErrorHints json.RawMessage `json:"errorHints"`
	}
	if json.Unmarshal([]byte(configJSON), &cfg) != nil || len(cfg.ErrorHints) == 0 {
		return ""
	}
	return string(cfg.ErrorHints)
}

func parseErrorHints(rawJSON string, limit int) []errorHint {
	if strings.TrimSpace(rawJSON) == "" {
		return nil
	}
	var raw []errorHint
	if json.Unmarshal([]byte(rawJSON), &raw) != nil {
		return nil
	}
	out := make([]errorHint, 0, len(raw))
	for _, h := range raw {
		h.Contains = strings.TrimSpace(h.Contains)
		h.Message = truncateUserFacingMessage(strings.TrimSpace(h.Message))
		if h.Contains == "" || h.Message == "" {
			continue
		}
		out = append(out, h)
		if len(out) >= limit {
			break
		}
	}
	return out
}

// hintsFor collects the rules that apply to a model, most specific first:
// the model's own hints, then type-scoped globals, then unscoped globals.
func (s *errorHintSnapshot) hintsFor(refs ...string) []errorHint {
	if s == nil {
		return nil
	}
	var modelHints []errorHint
	modelType := ""
	for _, ref := range refs {
		key := strings.ToLower(strings.TrimSpace(ref))
		if key == "" {
			continue
		}
		if hints, ok := s.byRef[key]; ok && modelHints == nil {
			modelHints = hints
		}
		if t, ok := s.typeOf[key]; ok && modelType == "" {
			modelType = t
		}
	}
	typeHints := s.byType[modelType]
	if len(typeHints) == 0 && len(s.global) == 0 {
		return modelHints
	}
	// 必须组装全新切片:直接 append 到缓存快照里的共享切片,容量富余时会写进
	// 共享底层数组,并发分类互相踩内存。
	out := make([]errorHint, 0, len(modelHints)+len(typeHints)+len(s.global))
	out = append(out, modelHints...)
	out = append(out, typeHints...)
	return append(out, s.global...)
}

// match returns the first admin-authored message whose Contains fragment
// appears (case-insensitively) in the raw error text.
func (s *errorHintSnapshot) match(raw string, refs ...string) (string, bool) {
	if s == nil || strings.TrimSpace(raw) == "" {
		return "", false
	}
	low := strings.ToLower(raw)
	for _, h := range s.hintsFor(refs...) {
		if strings.Contains(low, strings.ToLower(h.Contains)) {
			return h.Message, true
		}
	}
	return "", false
}

func (s *errorHintSnapshot) isConfiguredMessage(message string) bool {
	if s == nil {
		return false
	}
	_, ok := s.messages[message]
	return ok
}

// userFacingGenErrorForModel is the write-time classifier: admin-authored
// hints win over the built-in mapping so operators can correct any copy
// without a deploy; unmatched errors fall through to userFacingGenError.
func userFacingGenErrorForModel(db *gorm.DB, m *model.AiModel, err error) string {
	if err != nil && m != nil {
		snap := errorHintsSnapshot(db)
		if msg, ok := snap.match(err.Error(), m.ID.String(), m.ModelID, m.Name); ok {
			return msg
		}
	}
	return userFacingGenError(err)
}
