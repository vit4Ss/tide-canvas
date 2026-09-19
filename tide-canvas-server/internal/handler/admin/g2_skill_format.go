package admin

import (
	"errors"
	"fmt"
	"io"
	"net/http"
	"path"
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/gin-gonic/gin"
	"gopkg.in/yaml.v3"

	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/response"
)

// https://agentskills.io/specification. Execution manifests are a separate,
// application-specific check; a valid manifest cannot make plain text a Skill.
type skillFormatMetadata struct {
	Name        string `json:"name"`
	Description string `json:"description"`
}

type skillFormatError struct{ reason string }

func (e *skillFormatError) Error() string    { return "Skill 格式不符合规范：" + e.reason }
func invalidSkillFormat(reason string) error { return &skillFormatError{reason: reason} }

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
	if path.Base(primary) != "SKILL.md" {
		return nil, invalidSkillFormat("主文件必须命名为 SKILL.md（区分大小写），不接受普通 .md/.txt 作为主文件")
	}
	root := path.Dir(primary)
	parent := archiveParent
	if root != "." {
		parent = path.Base(root)
	}
	var content string
	for _, file := range files {
		if file.Path == primary {
			content = file.Content
		}
		if root != "." && !strings.HasPrefix(file.Path, root+"/") {
			return nil, invalidSkillFormat(fmt.Sprintf("文件 %q 不在 SKILL.md 所属目录内", file.Path))
		}
		if file.Path != primary && strings.EqualFold(path.Base(file.Path), "SKILL.md") {
			return nil, invalidSkillFormat("一个 Skill 文件包只能有一个 SKILL.md，请将多个技能分开导入")
		}
	}
	meta, err := parseStandardSkillDocument(content)
	if err != nil {
		return nil, err
	}
	if parent != "" && parent != meta.Name {
		return nil, invalidSkillFormat(fmt.Sprintf("name %q 必须与所属目录名 %q 一致", meta.Name, parent))
	}
	return meta, nil
}

func yamlValue(node *yaml.Node) *yaml.Node {
	for depth := 0; node != nil && node.Kind == yaml.AliasNode; depth++ {
		if depth >= 8 {
			return nil
		}
		node = node.Alias
	}
	return node
}

func skillYAMLString(node *yaml.Node) (string, bool) {
	node = yamlValue(node)
	if node == nil || node.Kind != yaml.ScalarNode || node.Tag != "!!str" {
		return "", false
	}
	return node.Value, true
}

func parseStandardSkillDocument(raw string) (*skillFormatMetadata, error) {
	if len(raw) > maxSkillExecutablePromptBytes {
		return nil, invalidSkillFormat("SKILL.md 超过本站 1 MB 主文件上限")
	}
	if !utf8.ValidString(raw) || strings.ContainsRune(raw, '\x00') {
		return nil, invalidSkillFormat("SKILL.md 必须是有效的 UTF-8 文本")
	}
	text := strings.ReplaceAll(strings.TrimPrefix(raw, "\ufeff"), "\r\n", "\n")
	lines := strings.Split(text, "\n")
	if len(lines) == 0 || strings.TrimRight(lines[0], " \t") != "---" {
		return nil, invalidSkillFormat("SKILL.md 必须以 --- 开始的 YAML 元数据开头，且包含 name 和 description")
	}
	end := -1
	for i := 1; i < len(lines); i++ {
		if strings.TrimRight(lines[i], " \t") == "---" {
			end = i
			break
		}
	}
	if end < 0 {
		return nil, invalidSkillFormat("YAML 元数据缺少结束分隔符 ---")
	}
	if strings.TrimSpace(strings.Join(lines[end+1:], "\n")) == "" {
		return nil, invalidSkillFormat("YAML 元数据之后必须提供 Markdown 技能说明，正文不能为空")
	}
	header := strings.Join(lines[1:end], "\n")
	var document yaml.Node
	decoder := yaml.NewDecoder(strings.NewReader(header))
	if err := decoder.Decode(&document); err != nil || len(document.Content) != 1 || document.Content[0].Kind != yaml.MappingNode {
		return nil, invalidSkillFormat("YAML 元数据语法错误，必须是键值对象")
	}
	var trailing yaml.Node
	if err := decoder.Decode(&trailing); !errors.Is(err, io.EOF) {
		return nil, invalidSkillFormat("YAML 元数据只能包含一个对象")
	}
	fields := map[string]*yaml.Node{}
	allowed := map[string]bool{"name": true, "description": true, "license": true, "compatibility": true, "metadata": true, "allowed-tools": true}
	pairs := document.Content[0].Content
	for i := 0; i < len(pairs); i += 2 {
		key, ok := skillYAMLString(pairs[i])
		if !ok || !allowed[key] {
			return nil, invalidSkillFormat(fmt.Sprintf("不支持的 YAML 字段 %q；扩展信息请放入 metadata", pairs[i].Value))
		}
		if _, exists := fields[key]; exists {
			return nil, invalidSkillFormat(fmt.Sprintf("YAML 字段 %q 重复", key))
		}
		fields[key] = pairs[i+1]
	}
	name, nameOK := skillYAMLString(fields["name"])
	if !nameOK || name == "" || utf8.RuneCountInString(name) > 64 || strings.HasPrefix(name, "-") || strings.HasSuffix(name, "-") || strings.Contains(name, "--") {
		return nil, invalidSkillFormat("name 必须为 1–64 个小写字母、数字或连字符，不能以连字符开头/结尾或包含连续连字符")
	}
	for _, r := range name {
		if r != '-' && !unicode.IsDigit(r) && !(unicode.IsLetter(r) && !unicode.IsUpper(r) && !unicode.IsTitle(r)) {
			return nil, invalidSkillFormat("name 只能包含小写字母、数字和连字符，不能包含空格或下划线")
		}
	}
	description, descriptionOK := skillYAMLString(fields["description"])
	if !descriptionOK || strings.TrimSpace(description) == "" || utf8.RuneCountInString(description) > 1024 {
		return nil, invalidSkillFormat("description 必须为非空字符串，且不超过 1024 个字符")
	}
	for _, key := range []string{"license", "compatibility", "allowed-tools"} {
		if node, exists := fields[key]; exists {
			value, ok := skillYAMLString(node)
			if !ok {
				return nil, invalidSkillFormat(key + " 必须是字符串")
			}
			if key == "compatibility" && (strings.TrimSpace(value) == "" || utf8.RuneCountInString(value) > 500) {
				return nil, invalidSkillFormat("compatibility 必须为 1–500 个字符")
			}
		}
	}
	if node, exists := fields["metadata"]; exists {
		node = yamlValue(node)
		if node == nil || node.Kind != yaml.MappingNode {
			return nil, invalidSkillFormat("metadata 必须是字符串键值对象")
		}
		seen := map[string]bool{}
		for i := 0; i < len(node.Content); i += 2 {
			key, keyOK := skillYAMLString(node.Content[i])
			_, valueOK := skillYAMLString(node.Content[i+1])
			if !keyOK || !valueOK || seen[key] {
				return nil, invalidSkillFormat("metadata 的键和值都必须是字符串，且不能有重复键")
			}
			seen[key] = true
		}
	}
	return &skillFormatMetadata{Name: name, Description: description}, nil
}
