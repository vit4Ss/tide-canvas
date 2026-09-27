package admin

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"unicode/utf8"

	"github.com/gin-gonic/gin"
	"gopkg.in/yaml.v3"

	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/response"
)

type SkillAdaptationReplacement struct {
	From    string `json:"from"`
	To      string `json:"to"`
	Handler string `json:"handler"`
}
type SkillAdaptationRemoval struct {
	Feature string `json:"feature"`
	Reason  string `json:"reason"`
}
type SkillAdaptationReport struct {
	Status       string                       `json:"status"`
	Summary      string                       `json:"summary"`
	Replacements []SkillAdaptationReplacement `json:"replacements"`
	Removed      []SkillAdaptationRemoval     `json:"removed"`
	Limitations  []string                     `json:"limitations"`
}

type AdminSkillImportSource struct {
	PrimaryFilePath string                `json:"primaryFilePath"`
	Files           []AdminSkillFileDTO   `json:"files"`
	SourceURL       string                `json:"sourceUrl,omitempty"`
	Report          SkillAdaptationReport `json:"report"`
	Reviewed        bool                  `json:"reviewed"`
}

type skillAdaptationPreviewDTO struct {
	AdminSkillImportSource
	Description  string `json:"description"`
	Instructions string `json:"instructions"`
}

var adaptationHandlers = map[string]bool{
	"skill_text_completion": true, "assistant_chat": true,
	"text_to_image": true, "image_to_image": true, "text_to_video": true,
	"image_to_video": true, "start_end_to_video": true, "reference_to_video": true, "text_to_audio": true,
	"analyze_image": true, "analyze_video": true, "analyze_audio": true, "analyze_webpage": true,
	"render_pptx": true, "render_xlsx": true, "render_docx": true, "render_markdown": true,
}

func adaptationText(value string, limit int) bool {
	return strings.TrimSpace(value) != "" && utf8.ValidString(value) && !strings.ContainsRune(value, 0) && utf8.RuneCountInString(value) <= limit
}

func validateSkillAdaptationReport(report SkillAdaptationReport) error {
	if report.Status != "ready" && report.Status != "partial" {
		return errors.New("当前 Skill 没有可导入的平台适配结果")
	}
	if !adaptationText(report.Summary, 1000) || len(report.Replacements) > 24 || len(report.Removed) > 24 || len(report.Limitations) > 12 {
		return errors.New("Skill 适配说明不完整或超过长度限制")
	}
	if len(report.Removed) > 0 && report.Status != "partial" {
		return errors.New("移除原有能力的 Skill 必须标记为部分适配")
	}
	if report.Status == "partial" && len(report.Removed) == 0 && len(report.Limitations) == 0 {
		return errors.New("部分适配必须说明被移除的能力或限制")
	}
	for _, item := range report.Replacements {
		if !adaptationText(item.From, 300) || !adaptationText(item.To, 500) || !adaptationHandlers[item.Handler] {
			return errors.New("适配映射只能指向本站已注册的处理器")
		}
	}
	for _, item := range report.Removed {
		if !adaptationText(item.Feature, 300) || !adaptationText(item.Reason, 500) {
			return errors.New("移除的能力必须说明名称及原因")
		}
	}
	for _, item := range report.Limitations {
		if !adaptationText(item, 500) {
			return errors.New("适配限制说明无效")
		}
	}
	return nil
}

func validateSkillImportSource(source *AdminSkillImportSource) error {
	if source == nil {
		return nil
	}
	if strings.TrimSpace(source.PrimaryFilePath) == "" {
		return errors.New("适配来源必须指定原始 SKILL.md 路径")
	}
	if _, err := validateStandardSkillPackage(source.Files, source.PrimaryFilePath); err != nil {
		return err
	}
	if source.SourceURL != "" {
		u, err := url.Parse(source.SourceURL)
		if err != nil || len(source.SourceURL) > 2048 || u.Scheme != "https" || u.Host != "github.com" || u.User != nil || u.RawQuery != "" {
			return errors.New("Skill 适配来源必须为无凭证的 GitHub HTTPS 地址")
		}
	}
	return validateSkillAdaptationReport(source.Report)
}

// Creates a *separate* executable document. Source files are retained in an
// admin-only column, not as references that can accidentally enter a prompt.
func prepareSkillAdaptation(dto skillAdaptationPreviewDTO) ([]AdminSkillFileDTO, error) {
	if err := validateSkillImportSource(&dto.AdminSkillImportSource); err != nil {
		return nil, err
	}
	meta, err := validateStandardSkillPackage(dto.Files, dto.PrimaryFilePath)
	if err != nil {
		return nil, err
	}
	if !adaptationText(dto.Instructions, 32000) || !adaptationText(dto.Description, 1024) {
		return nil, errors.New("适配版说明和正文不能为空（正文最多 32000 字）")
	}
	if strings.Contains(dto.Instructions, "{{skill.") {
		return nil, errors.New("适配版必须自包含，不能再次引用未适配的原文件")
	}
	header := map[string]any{"name": meta.Name, "description": dto.Description, "compatibility": "FlowLight server-side Skill runtime", "metadata": map[string]string{"flowlight-adapted": "true"}}
	// Preserve original attribution/license metadata, but not original external
	// tool permissions or compatibility claims.
	for _, file := range dto.Files {
		if file.Path != dto.PrimaryFilePath {
			continue
		}
		lines := strings.Split(strings.ReplaceAll(strings.TrimPrefix(file.Content, "\ufeff"), "\r\n", "\n"), "\n")
		for i := 1; i < len(lines); i++ {
			if strings.TrimSpace(lines[i]) != "---" {
				continue
			}
			var original map[string]any
			if yaml.Unmarshal([]byte(strings.Join(lines[1:i], "\n")), &original) == nil {
				if license, ok := original["license"].(string); ok {
					header["license"] = license
				}
				if metadata, ok := original["metadata"].(map[string]any); ok {
					delete(metadata, "flowlight-draft-source")
					metadata["flowlight-adapted"] = "true"
					header["metadata"] = metadata
				}
			}
			break
		}
	}
	yml, err := yaml.Marshal(header)
	if err != nil {
		return nil, err
	}
	files := []AdminSkillFileDTO{{Path: "SKILL.md", Content: "---\n" + string(yml) + "---\n\n" + strings.TrimSpace(dto.Instructions) + "\n", MimeType: "text/markdown; charset=utf-8"}}
	if _, err := validateStandardSkillPackage(files, "SKILL.md"); err != nil {
		return nil, err
	}
	return files, nil
}

func (h *skillsHandler) previewSkillAdaptation(c *gin.Context) {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxSkillImportBodyBytes)
	var dto skillAdaptationPreviewDTO
	if err := decodeSkillJSON(c.Request.Body, &dto); err != nil {
		response.Fail(c, response.CodeBadRequest, "Skill 适配请求无效")
		return
	}
	files, err := prepareSkillAdaptation(dto)
	if err != nil {
		response.Fail(c, response.CodeBadRequest, err.Error())
		return
	}
	dto.Reviewed = false
	response.OK(c, struct {
		PrimaryFilePath string                 `json:"primaryFilePath"`
		Files           []AdminSkillFileDTO    `json:"files"`
		ImportSource    AdminSkillImportSource `json:"importSource"`
	}{"SKILL.md", files, dto.AdminSkillImportSource})
}

func encodeSkillImportSource(source *AdminSkillImportSource, primary string, files []model.SkillFile, manifest string) (string, error) {
	if source == nil {
		return "", nil
	}
	if !source.Reviewed {
		return "", errors.New("请先确认 Skill 适配后的能力变更，再导入")
	}
	if err := validateSkillImportSource(source); err != nil {
		return "", err
	}
	original, _ := validateStandardSkillPackage(source.Files, source.PrimaryFilePath)
	adapted, err := validateStandardSkillFiles(files, primary, "")
	if err != nil {
		return "", err
	}
	if original.Name != adapted.Name {
		return "", errors.New("适配版 Skill 名称必须与原文件一致")
	}
	if len(files) != 1 || primary != "SKILL.md" || strings.Contains(files[0].Content, "{{skill.") {
		return "", errors.New("适配执行包必须为独立 SKILL.md；原文件仅作后台留档")
	}
	var plan struct {
		Steps []struct {
			Handler string `json:"handler"`
		} `json:"steps"`
	}
	if json.Unmarshal([]byte(manifest), &plan) != nil {
		return "", errors.New("适配运行流程无效")
	}
	for _, replacement := range source.Report.Replacements {
		found := false
		for _, step := range plan.Steps {
			if step.Handler == replacement.Handler {
				found = true
				break
			}
		}
		if !found {
			return "", fmt.Errorf("适配说明声明了 %s，但运行流程未使用该处理器", replacement.Handler)
		}
	}
	encoded, err := json.Marshal(source)
	return string(encoded), err
}

func skillVersionAdminVO(version model.SkillVersion, files []model.SkillFile) AdminSkillVersionVO {
	var source json.RawMessage
	if version.ImportSourceJSON != "" {
		source = json.RawMessage(version.ImportSourceJSON)
	}
	return AdminSkillVersionVO{SkillVersion: version, Files: files, ImportSource: source}
}
