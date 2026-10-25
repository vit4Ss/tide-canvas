package model

import (
	"regexp"
	"strconv"
	"strings"
)

var templateVideoHeader = regexp.MustCompile(`^生成视频\s*[:：]\s*([0-9]+(?:\.[0-9]+)?)\s*秒(?:\s*[｜|]\s*([1-9][0-9]{0,2})\s*[:：]\s*([1-9][0-9]{0,2}))?`)
var templateSeedance25 = regexp.MustCompile(`(?i)(?:^|[^a-z0-9])seedance[\s._-]*2[._-]5(?:$|[^0-9])`)

// Only the opening production header is a specification. Mentions of 30 seconds
// inside shot lists or alternative instructions must not change the model.
func TemplateVideoPromptOptions(prompt string) StudioTemplateOptions {
	line := strings.SplitN(strings.TrimSpace(strings.TrimPrefix(strings.TrimSpace(prompt), "\ufeff")), "\n", 2)[0]
	line = strings.TrimSpace(strings.TrimLeft(line, "【["))
	match := templateVideoHeader.FindStringSubmatch(line)
	if len(match) == 0 {
		return StudioTemplateOptions{}
	}
	duration, _ := strconv.ParseFloat(match[1], 64)
	if duration <= 0 || duration > 600 {
		return StudioTemplateOptions{}
	}
	options := StudioTemplateOptions{Duration: duration}
	if match[2] != "" {
		options.AspectRatio = match[2] + ":" + match[3]
	}
	return options
}

func WithTemplatePromptDefaults(row StudioTemplate) StudioTemplate {
	if row.MediaType != "video" {
		return row
	}
	inferred := TemplateVideoPromptOptions(row.Prompt)
	if row.Options.Duration == 0 {
		row.Options.Duration = inferred.Duration
	}
	if strings.TrimSpace(row.Options.AspectRatio) == "" {
		row.Options.AspectRatio = inferred.AspectRatio
	}
	return row
}

func TemplatePrefersSeedance25(row StudioTemplate) bool {
	return row.MediaType == "video" && TemplateVideoPromptOptions(row.Prompt).Duration == 30 &&
		WithTemplatePromptDefaults(row).Options.Duration == 30
}

func IsTemplateSeedance25(modelKey, name string) bool {
	return templateSeedance25.MatchString(modelKey) || templateSeedance25.MatchString(name)
}
