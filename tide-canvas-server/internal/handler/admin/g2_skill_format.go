package admin

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"

	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/response"
	"tidecanvas/internal/pkg/skillformat"
)

// https://agentskills.io/specification. Execution manifests are a separate,
// application-specific check; a valid manifest cannot make plain text a Skill.
type skillFormatMetadata = skillformat.Metadata
type skillFormatError = skillformat.Error

func invalidSkillFormat(reason string) error { return skillformat.Invalid(reason) }

type AdminSkillFilePackageDTO struct {
	PrimaryFilePath string              `json:"primaryFilePath"`
	Files           []AdminSkillFileDTO `json:"files"`
}

type skillFileValidationItem struct {
	Index       int      `json:"index"`
	Valid       bool     `json:"valid"`
	Errors      []string `json:"errors"`
	Name        string   `json:"name,omitempty"`
	Description string   `json:"description,omitempty"`
}

// validateSkillFiles is used before asking AI to generate a manifest. Final
// writes repeat the same validation and never trust this preflight response.
func (h *skillsHandler) validateSkillFiles(c *gin.Context) {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxSkillImportBodyBytes)
	var dto struct {
		Packages []AdminSkillFilePackageDTO `json:"packages"`
	}
	if err := decodeSkillJSON(c.Request.Body, &dto); err != nil {
		response.Fail(c, response.CodeBadRequest, "Skill 文件校验请求无效或超过大小限制")
		return
	}
	if len(dto.Packages) == 0 || len(dto.Packages) > 50 {
		response.Fail(c, response.CodeBadRequest, "一次必须校验 1 至 50 个 Skill 文件包")
		return
	}
	groups := make([][]AdminSkillFileDTO, len(dto.Packages))
	for i := range dto.Packages {
		groups[i] = dto.Packages[i].Files
	}
	if err := validateSkillBatchFileSize(groups); err != nil {
		response.Fail(c, response.CodeBadRequest, err.Error())
		return
	}
	items := make([]skillFileValidationItem, 0, len(dto.Packages))
	valid := true
	for index, pkg := range dto.Packages {
		meta, err := validateStandardSkillPackage(pkg.Files, pkg.PrimaryFilePath)
		item := skillFileValidationItem{Index: index, Valid: err == nil, Errors: []string{}}
		if err != nil {
			valid = false
			item.Errors = append(item.Errors, describeSkillImportError(err))
		} else {
			item.Name = meta.Name
			item.Description = meta.Description
		}
		items = append(items, item)
	}
	response.OK(c, struct {
		Valid bool                      `json:"valid"`
		Items []skillFileValidationItem `json:"items"`
	}{valid, items})
}

func validateSkillBatchFileSize(groups [][]AdminSkillFileDTO) error {
	total := 0
	for _, files := range groups {
		for _, file := range files {
			if len(file.Content) > maxSkillImportTotalBytes-total {
				return errors.New("本次导入的 Skill 文本文件合计超过 8 MB")
			}
			total += len(file.Content)
		}
	}
	return nil
}

func validateStandardSkillPackage(in []AdminSkillFileDTO, requestedPrimary string) (*skillFormatMetadata, error) {
	if len(in) == 0 {
		return nil, invalidSkillFormat("必须提供 SKILL.md，不能将普通提示词直接作为文件包导入")
	}
	files, primary, err := normalizeSkillFiles(in, requestedPrimary)
	if err != nil {
		return nil, err
	}
	return validateStandardSkillFiles(files, primary, "")
}

func validateStandardSkillFiles(files []model.SkillFile, primary, archiveParent string) (*skillFormatMetadata, error) {
	input := make([]skillformat.File, len(files))
	for i, file := range files {
		input[i] = skillformat.File{Path: file.Path, Content: file.Content}
	}
	return skillformat.ValidateFiles(input, primary, archiveParent)
}

func parseStandardSkillDocument(raw string) (*skillFormatMetadata, error) {
	return skillformat.ParseDocument(raw)
}
