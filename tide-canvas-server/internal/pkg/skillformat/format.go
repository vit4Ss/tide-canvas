package skillformat

import (
	"errors"
	"fmt"
	"io"
	"path"
	"strings"
	"unicode"
	"unicode/utf8"

	"gopkg.in/yaml.v3"
)

// Shared Agent Skills format validation for imports, publishing and MCP.
// The size limit is a product limit, separate from the format specification.
const MaxDocumentBytes = 1 << 20

type File struct {
	Path    string
	Content string
}
type Metadata struct {
	Name        string `json:"name"`
	Description string `json:"description"`
}
type Error struct{ Reason string }

func (e *Error) Error() string    { return "Skill 格式不符合规范：" + e.Reason }
func Invalid(reason string) error { return &Error{Reason: reason} }

func ValidateFiles(files []File, primary, archiveParent string) (*Metadata, error) {
	if len(files) == 0 {
		return nil, Invalid("必须提供完整的 SKILL.md 文件包")
	}
	if path.Base(primary) != "SKILL.md" {
		return nil, Invalid("主文件必须命名为 SKILL.md（区分大小写），不接受普通 .md/.txt 作为主文件")
	}
	root := path.Dir(primary)
	parent := archiveParent
	if root != "." {
		parent = path.Base(root)
	}
	var content string
	seen := map[string]bool{}
	found := false
	for _, file := range files {
		if file.Path == "" || path.Clean(file.Path) != file.Path || strings.HasPrefix(file.Path, "/") || strings.HasPrefix(file.Path, "../") || strings.ContainsAny(file.Path, "\\:\x00") {
			return nil, Invalid("Skill 文件路径无效")
		}
		if seen[strings.ToLower(file.Path)] {
			return nil, Invalid("Skill 文件路径重复")
		}
		seen[strings.ToLower(file.Path)] = true
		if file.Path == primary {
			content = file.Content
			found = true
		}
		if root != "." && !strings.HasPrefix(file.Path, root+"/") {
			return nil, Invalid(fmt.Sprintf("文件 %q 不在 SKILL.md 所属目录内", file.Path))
		}
		if file.Path != primary && strings.EqualFold(path.Base(file.Path), "SKILL.md") {
			return nil, Invalid("一个 Skill 文件包只能有一个 SKILL.md，请将多个技能分开导入")
		}
	}
	if !found {
		return nil, Invalid("找不到 SKILL.md 主文件")
	}
	meta, err := ParseDocument(content)
	if err != nil {
		return nil, err
	}
	if parent != "" && parent != meta.Name {
		return nil, Invalid(fmt.Sprintf("name %q 必须与所属目录名 %q 一致", meta.Name, parent))
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

func ParseDocument(raw string) (*Metadata, error) {
	if len(raw) > MaxDocumentBytes {
		return nil, Invalid("SKILL.md 超过本站 1 MB 主文件上限")
	}
	if !utf8.ValidString(raw) || strings.ContainsRune(raw, '\x00') {
		return nil, Invalid("SKILL.md 必须是有效的 UTF-8 文本")
	}
	text := strings.ReplaceAll(strings.TrimPrefix(raw, "\ufeff"), "\r\n", "\n")
	lines := strings.Split(text, "\n")
	if len(lines) == 0 || strings.TrimRight(lines[0], " \t") != "---" {
		return nil, Invalid("SKILL.md 必须以 --- 开始的 YAML 元数据开头，且包含 name 和 description")
	}
	end := -1
	for i := 1; i < len(lines); i++ {
		if strings.TrimRight(lines[i], " \t") == "---" {
			end = i
			break
		}
	}
	if end < 0 {
		return nil, Invalid("YAML 元数据缺少结束分隔符 ---")
	}
	if strings.TrimSpace(strings.Join(lines[end+1:], "\n")) == "" {
		return nil, Invalid("YAML 元数据之后必须提供 Markdown 技能说明，正文不能为空")
	}
	header := strings.Join(lines[1:end], "\n")
	var document yaml.Node
	decoder := yaml.NewDecoder(strings.NewReader(header))
	if err := decoder.Decode(&document); err != nil || len(document.Content) != 1 || document.Content[0].Kind != yaml.MappingNode {
		return nil, Invalid("YAML 元数据语法错误，必须是键值对象")
	}
	var trailing yaml.Node
	if err := decoder.Decode(&trailing); !errors.Is(err, io.EOF) {
		return nil, Invalid("YAML 元数据只能包含一个对象")
	}
	fields := map[string]*yaml.Node{}
	allowed := map[string]bool{"name": true, "description": true, "license": true, "compatibility": true, "metadata": true, "allowed-tools": true}
	pairs := document.Content[0].Content
	for i := 0; i < len(pairs); i += 2 {
		key, ok := skillYAMLString(pairs[i])
		if !ok || !allowed[key] {
			return nil, Invalid(fmt.Sprintf("不支持的 YAML 字段 %q；扩展信息请放入 metadata", pairs[i].Value))
		}
		if _, exists := fields[key]; exists {
			return nil, Invalid(fmt.Sprintf("YAML 字段 %q 重复", key))
		}
		fields[key] = pairs[i+1]
	}
	name, nameOK := skillYAMLString(fields["name"])
	if !nameOK || name == "" || utf8.RuneCountInString(name) > 64 || strings.HasPrefix(name, "-") || strings.HasSuffix(name, "-") || strings.Contains(name, "--") {
		return nil, Invalid("name 必须为 1–64 个小写字母、数字或连字符，不能以连字符开头/结尾或包含连续连字符")
	}
	for _, r := range name {
		if r != '-' && !unicode.IsDigit(r) && !(unicode.IsLetter(r) && !unicode.IsUpper(r) && !unicode.IsTitle(r)) {
			return nil, Invalid("name 只能包含小写字母、数字和连字符，不能包含空格或下划线")
		}
	}
	description, descriptionOK := skillYAMLString(fields["description"])
	if !descriptionOK || strings.TrimSpace(description) == "" || utf8.RuneCountInString(description) > 1024 {
		return nil, Invalid("description 必须为非空字符串，且不超过 1024 个字符")
	}
	for _, key := range []string{"license", "compatibility", "allowed-tools"} {
		if node, exists := fields[key]; exists {
			value, ok := skillYAMLString(node)
			if !ok {
				return nil, Invalid(key + " 必须是字符串")
			}
			if key == "compatibility" && (strings.TrimSpace(value) == "" || utf8.RuneCountInString(value) > 500) {
				return nil, Invalid("compatibility 必须为 1–500 个字符")
			}
		}
	}
	if node, exists := fields["metadata"]; exists {
		node = yamlValue(node)
		if node == nil || node.Kind != yaml.MappingNode {
			return nil, Invalid("metadata 必须是字符串键值对象")
		}
		seen := map[string]bool{}
		for i := 0; i < len(node.Content); i += 2 {
			key, keyOK := skillYAMLString(node.Content[i])
			_, valueOK := skillYAMLString(node.Content[i+1])
			if !keyOK || !valueOK || seen[key] {
				return nil, Invalid("metadata 的键和值都必须是字符串，且不能有重复键")
			}
			seen[key] = true
		}
	}
	return &Metadata{Name: name, Description: description}, nil
}
