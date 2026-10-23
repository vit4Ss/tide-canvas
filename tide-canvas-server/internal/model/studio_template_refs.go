package model

import (
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"unicode/utf8"
)

const MaxTemplateImages = 16

var templateImageToken = regexp.MustCompile(`\{\{image:([1-9][0-9]*)\}\}`)
var unboundTemplateImage = regexp.MustCompile(`@?图(?:片)?\s*[0-9]+`)

const templateReferenceIntro = "【本次参考素材对应关系】\n只按下列实际上传顺序读取图片；未上传的素材不能用其他图片顶替，正文中的缺图条件按未提供处理。\n"

func templateImageLabel(row StudioTemplate, slot int) string {
	if slot > 0 && slot <= len(row.InputLabels.Images) && strings.TrimSpace(row.InputLabels.Images[slot-1]) != "" {
		return row.InputLabels.Images[slot-1]
	}
	return fmt.Sprintf("图片位置%d", slot)
}

func ValidateTemplateImageReferences(mode string, req StudioTemplateRequirements, prompt string) error {
	seen := map[int]bool{}
	for _, slot := range req.OptionalImages {
		if (mode != "i2i" && mode != "ref") || slot < 1 || slot > req.Images || seen[slot] {
			return fmt.Errorf("可选图片位置无效，只能在图生图或多模态参考中设置现有的图片位置")
		}
		seen[slot] = true
	}
	if len(seen) > 0 && len(seen) >= req.Images {
		return fmt.Errorf("请至少保留一个必填图片位置")
	}
	for _, match := range templateImageToken.FindAllStringSubmatch(prompt, -1) {
		n, _ := strconv.Atoi(match[1])
		if n > req.Images || n > MaxTemplateImages {
			return fmt.Errorf("提示词引用了不存在的图片位置 %d", n)
		}
	}
	if strings.Contains(templateImageToken.ReplaceAllString(prompt, ""), "{{image:") {
		return fmt.Errorf("图片引用格式应为 {{image:1}}，编号对应图片用途位置")
	}
	if len(seen) > 0 && unboundTemplateImage.MatchString(templateImageToken.ReplaceAllString(prompt, "")) {
		return fmt.Errorf("含可选图片时，请将图片1、图2等编号引用改为 {{image:1}}、{{image:2}}，避免缺图后对应错误")
	}
	return nil
}

// Bound the fully expanded prompt for every optional-image combination without
// enumerating 2^N prompts. Missing labels can be longer than @图N; preflight
// must include that overhead so a published recipe works with omitted portraits.
func TemplatePromptMaxRunes(row StudioTemplate) int {
	if !templateImageToken.MatchString(row.Prompt) {
		return utf8.RuneCountInString(row.Prompt)
	}
	optional := map[int]bool{}
	for _, slot := range row.Requirements.OptionalImages {
		optional[slot] = true
	}
	count := utf8.RuneCountInString(templateReferenceIntro) + 1
	maxPosition := max(1, row.Requirements.Images)
	for slot := 1; slot <= row.Requirements.Images; slot++ {
		label := templateImageLabel(row, slot)
		present := utf8.RuneCountInString(fmt.Sprintf("%s：@图%d（实际第%d张图片）。\n", label, maxPosition, maxPosition))
		if optional[slot] {
			present = max(present, utf8.RuneCountInString(fmt.Sprintf("%s：未上传，不作为本次参考。\n", label)))
		}
		count += present
	}
	count += utf8.RuneCountInString(templateImageToken.ReplaceAllStringFunc(row.Prompt, func(token string) string {
		match := templateImageToken.FindStringSubmatch(token)
		slot, _ := strconv.Atoi(match[1])
		value := fmt.Sprintf("@图%d", maxPosition)
		if missing := "【未上传的" + templateImageLabel(row, slot) + "】"; optional[slot] && utf8.RuneCountInString(missing) > utf8.RuneCountInString(value) {
			return missing
		}
		return value
	}))
	return count
}

// ResolveTemplateImageReferences preserves the operator's slot identity while
// giving the model the compact order of the actual uploaded images. Missing
// references are explicit text, never a fake URL or another user's image.
func ResolveTemplateImageReferences(row StudioTemplate, slots []int) string {
	if !templateImageToken.MatchString(row.Prompt) {
		return row.Prompt
	}
	positions := map[int]int{}
	for index, slot := range slots {
		positions[slot] = index + 1
	}
	label := func(slot int) string { return templateImageLabel(row, slot) }
	var context strings.Builder
	context.WriteString(templateReferenceIntro)
	for slot := 1; slot <= row.Requirements.Images; slot++ {
		if position := positions[slot]; position > 0 {
			fmt.Fprintf(&context, "%s：@图%d（实际第%d张图片）。\n", label(slot), position, position)
		} else {
			fmt.Fprintf(&context, "%s：未上传，不作为本次参考。\n", label(slot))
		}
	}
	prompt := templateImageToken.ReplaceAllStringFunc(row.Prompt, func(token string) string {
		match := templateImageToken.FindStringSubmatch(token)
		slot, _ := strconv.Atoi(match[1])
		if position := positions[slot]; position > 0 {
			return fmt.Sprintf("@图%d", position)
		}
		return "【未上传的" + label(slot) + "】"
	})
	return context.String() + "\n" + prompt
}
