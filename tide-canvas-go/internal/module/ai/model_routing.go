package ai

import (
	"encoding/json"
	"math/rand/v2"
	"sort"
	"strings"
	"time"

	"github.com/tidecanvas/tide-canvas-go/internal/model"
)

type executionModel struct {
	ModelID         string
	ProviderID      int64
	LogicalModelID  int64
	UpstreamModelID int64
	RouteID         int64
	Strategy        string
	Reason          string
	CandidateCount  int
	FallbackUsed    bool
}

type modelRouteConfig struct {
	RouteStrategy string       `json:"routeStrategy"`
	Routes        []modelRoute `json:"routes"`
}

type modelRoute struct {
	ModelID    string   `json:"modelId"`
	ProviderID int64    `json:"-"`
	Handlers   []string `json:"handlers"`
	Complexity []string `json:"complexity"`
	Priority   int      `json:"priority"`
	Weight     int      `json:"weight"`
	Disabled   bool     `json:"disabled"`
}

func (r *modelRoute) UnmarshalJSON(data []byte) error {
	type rawRoute struct {
		ModelID    string      `json:"modelId"`
		ProviderID interface{} `json:"providerId"`
		Handlers   []string    `json:"handlers"`
		Complexity []string    `json:"complexity"`
		Priority   int         `json:"priority"`
		Weight     int         `json:"weight"`
		Disabled   bool        `json:"disabled"`
	}
	var raw rawRoute
	if err := json.Unmarshal(data, &raw); err != nil {
		return err
	}
	r.ModelID = raw.ModelID
	r.Handlers = raw.Handlers
	r.Complexity = raw.Complexity
	r.Priority = raw.Priority
	r.Weight = raw.Weight
	r.Disabled = raw.Disabled
	if id, ok := asInt64(raw.ProviderID); ok {
		r.ProviderID = id
	}
	return nil
}

type routeCandidate struct {
	route      model.AiModelRoute
	upstream   model.AiUpstreamModel
	matchScore int
}

func executionModelFromRecord(m *model.AiModel) executionModel {
	if m == nil {
		return executionModel{Reason: "default_provider", FallbackUsed: true}
	}
	return executionModel{ModelID: m.ModelID, ProviderID: m.ProviderID, LogicalModelID: m.ID, Reason: "logical_model_default", FallbackUsed: true}
}

func (s *Service) resolveExecutionModel(m *model.AiModel, handlerName string, input map[string]interface{}, preflight *promptPreflightResult) executionModel {
	base := executionModelFromRecord(m)
	if m == nil {
		return base
	}
	if exec, ok, err := s.resolveExecutionModelFromTables(m, handlerName, input, preflight); err != nil {
		if s.logger != nil {
			s.logger.Warnf("AI route resolver table lookup failed, falling back to model config: model=%s handler=%s err=%v", m.ModelID, handlerName, err)
		}
	} else if ok {
		return exec
	}
	if exec, ok := resolveExecutionModelFromConfig(m, handlerName, preflight); ok {
		exec.LogicalModelID = m.ID
		exec.Reason = "legacy_config_route"
		exec.FallbackUsed = true
		return exec
	}
	return base
}

func (s *Service) resolveExecutionModelFromTables(m *model.AiModel, handlerName string, input map[string]interface{}, preflight *promptPreflightResult) (executionModel, bool, error) {
	routes, err := s.repo.ListEnabledRoutes(m.ID, handlerName)
	if err != nil || len(routes) == 0 {
		return executionModel{}, false, err
	}
	all := make([]routeCandidate, 0, len(routes))
	complexityMatched := make([]routeCandidate, 0, len(routes))
	for _, route := range routes {
		matchScore, matched := routeInputMatchScore(route.Conditions, input)
		if !matched {
			continue
		}
		upstream, err := s.repo.FindUpstreamModelByID(route.UpstreamModelID)
		if err != nil {
			return executionModel{}, false, err
		}
		if upstream == nil || upstream.Status != 1 || !hasText(upstream.ModelID) {
			continue
		}
		if s.providerCircuitOpen(upstream.ProviderID) {
			continue
		}
		candidate := routeCandidate{route: route, upstream: *upstream, matchScore: matchScore}
		all = append(all, candidate)
		if preflight != nil && hasText(route.ComplexityLevel) && strings.EqualFold(route.ComplexityLevel, preflight.ComplexityLevel) {
			complexityMatched = append(complexityMatched, candidate)
		}
	}
	candidates := all
	if len(complexityMatched) > 0 {
		candidates = complexityMatched
	}
	if len(candidates) == 0 {
		return executionModel{}, false, nil
	}
	sort.SliceStable(candidates, func(i, j int) bool {
		if candidates[i].matchScore != candidates[j].matchScore {
			return candidates[i].matchScore > candidates[j].matchScore
		}
		return candidates[i].route.Priority > candidates[j].route.Priority
	})
	topScore := candidates[0].matchScore
	topCandidates := make([]routeCandidate, 0, len(candidates))
	for _, candidate := range candidates {
		if candidate.matchScore != topScore {
			break
		}
		topCandidates = append(topCandidates, candidate)
	}
	chosen := topCandidates[0]
	strategy := normalizeRouteStrategy(chosen.route.RouteStrategy)
	if strategy == "weighted" {
		chosen = chooseWeightedCandidate(topCandidates)
	}
	reason := "route_table"
	if chosen.matchScore > 0 {
		reason = "route_table_param_match"
	}
	return executionModel{
		ModelID:         chosen.upstream.ModelID,
		ProviderID:      chosen.upstream.ProviderID,
		LogicalModelID:  m.ID,
		UpstreamModelID: chosen.upstream.ID,
		RouteID:         chosen.route.ID,
		Strategy:        strategy,
		Reason:          reason,
		CandidateCount:  len(candidates),
		FallbackUsed:    false,
	}, true, nil
}

// routeInputMatchScore 将 ai_model_route.conditions 规范为可参与路由的匹配条件。
// 空条件作为兜底路由；条件越多，匹配分越高，会优先于兜底路由。
func routeInputMatchScore(conditions []byte, input map[string]interface{}) (int, bool) {
	raw := strings.TrimSpace(string(conditions))
	if raw == "" || raw == "{}" || strings.EqualFold(raw, "null") {
		return 0, true
	}
	var cfg map[string]interface{}
	if err := json.Unmarshal(conditions, &cfg); err != nil || len(cfg) == 0 {
		return 0, true
	}
	score := 0
	if ok, matched := matchStringCondition(conditionStringValues(cfg, "qualities", "quality"), strOf(input["quality"])); ok {
		if !matched {
			return 0, false
		}
		score++
	}
	if ok, matched := matchStringCondition(conditionStringValues(cfg, "clarities", "clarity"), resolutionOf(input)); ok {
		if !matched {
			return 0, false
		}
		score++
	}
	if ok, matched := matchStringCondition(conditionStringValues(cfg, "resolutions", "resolution"), resolutionOf(input)); ok {
		if !matched {
			return 0, false
		}
		score++
	}
	if ok, matched := matchStringCondition(conditionStringValues(cfg, "ratios", "aspectRatios", "aspectRatio", "ratio"), aspectOf(input, "auto")); ok {
		if !matched {
			return 0, false
		}
		score++
	}
	if ok, matched := matchIntCondition(conditionIntValues(cfg, "batchCounts", "batchCount", "counts", "n"), batchCountOf(input)); ok {
		if !matched {
			return 0, false
		}
		score++
	}
	if ok, matched := matchIntCondition(conditionIntValues(cfg, "durations", "duration"), routeDurationValue(input)); ok {
		if !matched {
			return 0, false
		}
		score++
	}
	return score, true
}

func matchStringCondition(values []string, actual string) (bool, bool) {
	if len(values) == 0 {
		return false, true
	}
	if !hasText(actual) {
		return true, false
	}
	return true, containsString(values, actual)
}

func matchIntCondition(values []int, actual int) (bool, bool) {
	if len(values) == 0 {
		return false, true
	}
	for _, value := range values {
		if value == actual {
			return true, true
		}
	}
	return true, false
}

func conditionStringValues(cfg map[string]interface{}, keys ...string) []string {
	values := make([]string, 0)
	for _, key := range keys {
		values = appendStringCondition(values, cfg[key])
	}
	return values
}

func appendStringCondition(values []string, value interface{}) []string {
	switch typed := value.(type) {
	case nil:
		return values
	case []interface{}:
		for _, item := range typed {
			values = appendStringCondition(values, item)
		}
		return values
	case []string:
		for _, item := range typed {
			values = appendStringCondition(values, item)
		}
		return values
	default:
		text := strings.TrimSpace(strOf(typed))
		if hasText(text) {
			values = append(values, text)
		}
		return values
	}
}

func conditionIntValues(cfg map[string]interface{}, keys ...string) []int {
	values := make([]int, 0)
	for _, key := range keys {
		values = appendIntCondition(values, cfg[key])
	}
	return values
}

func appendIntCondition(values []int, value interface{}) []int {
	switch typed := value.(type) {
	case nil:
		return values
	case []interface{}:
		for _, item := range typed {
			values = appendIntCondition(values, item)
		}
		return values
	case []int:
		return append(values, typed...)
	case float64:
		return append(values, int(typed))
	case float32:
		return append(values, int(typed))
	case int:
		return append(values, typed)
	case int64:
		return append(values, int(typed))
	default:
		if parsed := intFromInput(typed); parsed > 0 {
			values = append(values, parsed)
		}
		return values
	}
}

func routeDurationValue(input map[string]interface{}) int {
	if value := durationInt(input); value != nil {
		return *value
	}
	return 0
}

func (s *Service) providerCircuitOpen(providerID int64) bool {
	health, err := s.repo.FindProviderHealthByProviderID(providerID)
	if err != nil || health == nil {
		return false
	}
	if strings.EqualFold(health.HealthStatus, "down") {
		return true
	}
	return health.CircuitOpenUntil != nil && health.CircuitOpenUntil.After(time.Now())
}

func normalizeRouteStrategy(strategy string) string {
	switch strings.ToLower(strings.TrimSpace(strategy)) {
	case "weighted", "fallback", "latency":
		return strings.ToLower(strings.TrimSpace(strategy))
	default:
		return "priority"
	}
}

func chooseWeightedCandidate(candidates []routeCandidate) routeCandidate {
	total := 0
	for _, candidate := range candidates {
		if candidate.route.Weight > 0 {
			total += candidate.route.Weight
		}
	}
	if total <= 0 {
		return candidates[0]
	}
	pick := rand.IntN(total)
	for _, candidate := range candidates {
		if candidate.route.Weight <= 0 {
			continue
		}
		if pick < candidate.route.Weight {
			return candidate
		}
		pick -= candidate.route.Weight
	}
	return candidates[0]
}

func resolveExecutionModelFromConfig(m *model.AiModel, handlerName string, preflight *promptPreflightResult) (executionModel, bool) {
	if m == nil || len(m.Config) == 0 {
		return executionModel{}, false
	}
	var cfg modelRouteConfig
	if err := json.Unmarshal(m.Config, &cfg); err != nil || len(cfg.Routes) == 0 {
		return executionModel{}, false
	}
	candidates := make([]modelRoute, 0, len(cfg.Routes))
	complexityCandidates := make([]modelRoute, 0, len(cfg.Routes))
	for _, route := range cfg.Routes {
		if route.Disabled || !hasText(route.ModelID) {
			continue
		}
		if len(route.Handlers) > 0 && !containsString(route.Handlers, handlerName) {
			continue
		}
		candidates = append(candidates, route)
		if preflight != nil && len(route.Complexity) > 0 && containsString(route.Complexity, preflight.ComplexityLevel) {
			complexityCandidates = append(complexityCandidates, route)
		}
	}
	if len(complexityCandidates) > 0 {
		candidates = complexityCandidates
	}
	if len(candidates) == 0 {
		return executionModel{}, false
	}
	sort.SliceStable(candidates, func(i, j int) bool {
		return candidates[i].Priority > candidates[j].Priority
	})
	chosen := candidates[0]
	strategy := normalizeRouteStrategy(cfg.RouteStrategy)
	if strategy == "weighted" {
		chosen = chooseWeightedRoute(candidates)
	}
	return executionModel{ModelID: chosen.ModelID, ProviderID: chosen.ProviderID, Strategy: strategy, CandidateCount: len(candidates)}, true
}

func chooseWeightedRoute(routes []modelRoute) modelRoute {
	total := 0
	for _, route := range routes {
		if route.Weight > 0 {
			total += route.Weight
		}
	}
	if total <= 0 {
		return routes[0]
	}
	pick := rand.IntN(total)
	for _, route := range routes {
		if route.Weight <= 0 {
			continue
		}
		if pick < route.Weight {
			return route
		}
		pick -= route.Weight
	}
	return routes[0]
}

func (s *Service) recordRouteDecision(userID int64, taskID int64, dto *GenerateDTO, logicalModel *model.AiModel, execModel executionModel, preflight *promptPreflightResult) {
	uid := userID
	tid := taskID
	var logicalModelID *int64
	logicalModelName := dto.ModelID
	if logicalModel != nil {
		logicalModelID = &logicalModel.ID
		logicalModelName = logicalModel.ModelID
	}
	complexityLevel := ""
	complexityScore := 0
	if preflight != nil {
		complexityLevel = preflight.ComplexityLevel
		complexityScore = preflight.ComplexityScore
	}
	lg := &model.AiRouteDecisionLog{
		TaskID:          &tid,
		UserID:          &uid,
		LogicalModelID:  logicalModelID,
		UpstreamModelID: int64PtrIfPositive(execModel.UpstreamModelID),
		ProviderID:      int64PtrIfPositive(execModel.ProviderID),
		RouteID:         int64PtrIfPositive(execModel.RouteID),
		HandlerName:     dto.Handler,
		RouteStrategy:   execModel.Strategy,
		LogicalModel:    logicalModelName,
		UpstreamModel:   execModel.ModelID,
		ComplexityLevel: complexityLevel,
		ComplexityScore: complexityScore,
		DecisionReason:  execModel.Reason,
		CandidateCount:  execModel.CandidateCount,
		FallbackUsed:    boolToInt(execModel.FallbackUsed),
		DecisionMetadata: toJSON(map[string]interface{}{
			"projectId": dto.ProjectID,
			"handler":   dto.Handler,
		}),
	}
	if err := s.repo.InsertRouteDecisionLog(lg); err != nil && s.logger != nil {
		s.logger.Warnf("route decision log insert failed: taskId=%d err=%v", taskID, err)
	}
}
func containsString(list []string, value string) bool {
	for _, item := range list {
		if strings.EqualFold(strings.TrimSpace(item), value) {
			return true
		}
	}
	return false
}

func int64PtrIfPositive(v int64) *int64 {
	if v <= 0 {
		return nil
	}
	return &v
}
