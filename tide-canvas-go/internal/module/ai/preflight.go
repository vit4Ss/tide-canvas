package ai

import (
	"regexp"
	"strconv"
	"strings"
	"unicode/utf8"

	"gorm.io/datatypes"

	"github.com/tidecanvas/tide-canvas-go/internal/model"
)

const (
	promptActionAllow  = "allow"
	promptActionBlock  = "block"
	promptActionReview = "review"

	complexitySimple   = "simple"
	complexityStandard = "standard"
	complexityComplex  = "complex"
)

type promptPreflightResult struct {
	Action          string
	Category        string
	Reason          string
	MatchedPolicyID *int64
	ComplexityLevel string
	ComplexityScore int
	Tags            []string
}

func (s *Service) preflightPrompt(userID int64, dto *GenerateDTO) promptPreflightResult {
	prompt := strOf(dto.Input["prompt"])
	result := scorePromptComplexity(dto.Handler, dto.Input, prompt)
	result.Action = promptActionAllow

	policy, ok := s.matchPromptPolicy(prompt)
	if ok {
		result.Action = normalizePromptAction(policy.Action)
		result.Category = policy.Category
		result.Reason = policy.Name
		if policy.ID != 0 {
			id := policy.ID
			result.MatchedPolicyID = &id
		}
	}
	if result.Action == "" {
		result.Action = promptActionAllow
	}
	s.recordPromptReview(userID, dto, prompt, result)
	return result
}

func (s *Service) matchPromptPolicy(prompt string) (model.AiPromptPolicy, bool) {
	policies, err := s.repo.ListEnabledPromptPolicies()
	if err != nil && s.logger != nil {
		s.logger.Warnf("prompt policy query failed, using builtin defaults: %v", err)
	}
	if len(policies) == 0 {
		policies = builtinPromptPolicies()
	}
	normalized := normalizePrompt(prompt)
	for _, policy := range policies {
		if promptPolicyMatches(policy, normalized) {
			return policy, true
		}
	}
	return model.AiPromptPolicy{}, false
}

func promptPolicyMatches(policy model.AiPromptPolicy, normalizedPrompt string) bool {
	pattern := strings.TrimSpace(policy.Pattern)
	if pattern == "" {
		return false
	}
	switch strings.ToLower(strings.TrimSpace(policy.MatchType)) {
	case "regex":
		re, err := regexp.Compile("(?i)" + pattern)
		return err == nil && re.MatchString(normalizedPrompt)
	default:
		return strings.Contains(normalizedPrompt, normalizePrompt(pattern))
	}
}

func normalizePromptAction(action string) string {
	switch strings.ToLower(strings.TrimSpace(action)) {
	case promptActionBlock:
		return promptActionBlock
	case promptActionReview:
		return promptActionReview
	default:
		return promptActionAllow
	}
}

func normalizePrompt(prompt string) string {
	return strings.ToLower(strings.Join(strings.Fields(prompt), " "))
}

func builtinPromptPolicies() []model.AiPromptPolicy {
	return []model.AiPromptPolicy{
		{Name: "minor sexual content", Category: "sexual_minor", MatchType: "regex", Pattern: `(?:child|minor|underage|kid).*(?:nude|sex|sexual|porn|explicit)|(?:nude|sex|sexual|porn|explicit).*(?:child|minor|underage|kid)`, Action: promptActionBlock, Severity: 100, Status: 1},
		{Name: "explicit child abuse material", Category: "sexual_minor", MatchType: "regex", Pattern: `(?:csam|child sexual abuse|child porn|underage porn)`, Action: promptActionBlock, Severity: 100, Status: 1},
		{Name: "weapon or explosive construction", Category: "weapon_instruction", MatchType: "regex", Pattern: `(?:make|build|assemble|instructions?).*(?:bomb|explosive|detonator|improvised weapon)|(?:bomb|explosive|detonator).*(?:make|build|assemble)`, Action: promptActionBlock, Severity: 90, Status: 1},
		{Name: "credential theft", Category: "cyber_abuse", MatchType: "regex", Pattern: `(?:steal|phish|dump|exfiltrate).*(?:password|credential|token|cookie|account)|(?:password|credential|token|cookie).*(?:steal|phish|dump|exfiltrate)`, Action: promptActionBlock, Severity: 90, Status: 1},
		{Name: "hard drug manufacturing", Category: "drug_instruction", MatchType: "regex", Pattern: `(?:make|cook|synthesize|manufacture).*(?:meth|fentanyl|heroin|cocaine)|(?:meth|fentanyl|heroin|cocaine).*(?:recipe|synthesis|manufacture)`, Action: promptActionBlock, Severity: 90, Status: 1},
	}
}
func scorePromptComplexity(handlerName string, input map[string]interface{}, prompt string) promptPreflightResult {
	score := 0
	tags := make([]string, 0, 8)
	length := utf8.RuneCountInString(prompt)
	switch {
	case length > 900:
		score += 35
		tags = append(tags, "long_prompt")
	case length > 350:
		score += 20
		tags = append(tags, "medium_prompt")
	case length > 120:
		score += 10
	}

	if strings.Contains(handlerName, "video") {
		score += 25
		tags = append(tags, "video")
	}
	if strings.Contains(handlerName, "image_to") || strings.Contains(handlerName, "reference") || handlerName == "start_end_to_video" {
		score += 18
		tags = append(tags, "reference_input")
	}
	refCount := countPromptReferences(input)
	if refCount > 0 {
		score += minInt(25, refCount*5)
		tags = append(tags, "multi_reference")
	}
	if batchCountOf(input) > 1 {
		score += 8
		tags = append(tags, "batch")
	}
	if isHighResolution(input) {
		score += 10
		tags = append(tags, "high_resolution")
	}
	if duration := intFromInput(input["duration"]); duration >= 8 {
		score += 10
		tags = append(tags, "long_duration")
	}
	if strings.Count(prompt, ",")+strings.Count(prompt, "，")+strings.Count(prompt, ";")+strings.Count(prompt, "；") >= 6 {
		score += 10
		tags = append(tags, "many_constraints")
	}
	if score > 100 {
		score = 100
	}
	level := complexitySimple
	if score >= 70 {
		level = complexityComplex
	} else if score >= 35 {
		level = complexityStandard
	}
	return promptPreflightResult{ComplexityLevel: level, ComplexityScore: score, Tags: tags}
}

func countPromptReferences(input map[string]interface{}) int {
	total := 0
	for _, key := range []string{"references", "imageList", "videoReferences"} {
		total += len(collectURLList(input[key], 20))
	}
	for _, key := range []string{"sourceImage", "firstFrame", "lastFrame"} {
		if hasText(strOf(input[key])) {
			total++
		}
	}
	return total
}

func isHighResolution(input map[string]interface{}) bool {
	res := strings.ToUpper(strings.TrimSpace(strOf(input["resolution"])))
	return res == "2K" || res == "4K" || res == "1080P"
}

func intFromInput(v interface{}) int {
	n, err := strconv.Atoi(strings.TrimRight(strings.TrimSpace(strOf(v)), "sS"))
	if err != nil {
		return 0
	}
	return n
}

func minInt(a, b int) int {
	if a < b {
		return a
	}
	return b
}

func (s *Service) recordPromptReview(userID int64, dto *GenerateDTO, prompt string, result promptPreflightResult) {
	uid := userID
	lg := &model.AiPromptReviewLog{
		UserID:          &uid,
		HandlerName:     dto.Handler,
		LogicalModel:    dto.ModelID,
		Prompt:          truncate(prompt, 2000),
		Action:          result.Action,
		Category:        result.Category,
		Reason:          result.Reason,
		MatchedPolicyID: result.MatchedPolicyID,
		ComplexityLevel: result.ComplexityLevel,
		ComplexityScore: result.ComplexityScore,
		Tags:            datatypes.JSON(jsonString(result.Tags)),
		InputParams:     toJSON(dto.Input),
	}
	if err := s.repo.InsertPromptReviewLog(lg); err != nil && s.logger != nil {
		s.logger.Warnf("prompt review log insert failed: %v", err)
	}
}
