package admin

import (
	"archive/zip"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"net/http"
	"path"
	"sort"
	"strings"
	"unicode/utf8"

	"github.com/gin-gonic/gin"

	"tidecanvas/internal/pkg/response"
)

const (
	maxSkillArchiveBytes         = 16 << 20
	maxSkillArchiveBodyBytes     = 17 << 20
	maxSkillArchiveEntries       = 512
	maxSkillArchiveExpandedBytes = 64 << 20
)

type AdminSkillArchivePackageVO struct {
	Root            string              `json:"root"`
	PrimaryFilePath string              `json:"primaryFilePath"`
	Files           []AdminSkillFileDTO `json:"files"`
}

type AdminSkillArchivePreviewVO struct {
	Packages     []AdminSkillArchivePackageVO `json:"packages"`
	IgnoredFiles int                          `json:"ignoredFiles"`
}

type skillArchiveEntry struct {
	file *zip.File
	name string
}

func (h *skillsHandler) previewSkillArchive(c *gin.Context) {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxSkillArchiveBodyBytes)
	header, err := c.FormFile("file")
	if err != nil {
		var tooLarge *http.MaxBytesError
		if errors.As(err, &tooLarge) {
			response.Fail(c, response.CodeBadRequest, "ZIP Skill 包超过 16 MB 上传上限")
			return
		}
		response.Fail(c, response.CodeBadRequest, "请选择 ZIP Skill 包")
		return
	}
	if form := c.Request.MultipartForm; form != nil {
		defer form.RemoveAll()
	}
	if header.Size <= 0 || header.Size > maxSkillArchiveBytes {
		response.Fail(c, response.CodeBadRequest, "ZIP Skill 包必须在 16 MB 以内")
		return
	}
	ext := strings.ToLower(path.Ext(strings.ReplaceAll(header.Filename, "\\", "/")))
	if ext != ".zip" && ext != ".skill" {
		response.Fail(c, response.CodeBadRequest, "仅支持 .zip 或 .skill 压缩包")
		return
	}
	file, err := header.Open()
	if err != nil {
		response.Fail(c, response.CodeBadRequest, "Skill 压缩包无法读取")
		return
	}
	defer file.Close()

	reader, err := zip.NewReader(file, header.Size)
	if err != nil {
		response.Fail(c, response.CodeBadRequest, "文件不是有效的 ZIP Skill 包")
		return
	}
	preview, err := inspectSkillArchive(reader)
	if err != nil {
		response.Fail(c, response.CodeBadRequest, err.Error())
		return
	}
	response.OK(c, preview)
}

func cleanSkillArchivePath(raw string) (string, error) {
	if !utf8.ValidString(raw) || strings.ContainsAny(raw, "{}") || strings.IndexFunc(raw, func(r rune) bool {
		return r < 0x20 || r == 0x7f
	}) >= 0 {
		return "", errors.New("ZIP 包包含无效文件路径")
	}
	raw = strings.TrimSpace(strings.ReplaceAll(raw, "\\", "/"))
	if raw == "" || strings.HasPrefix(raw, "/") {
		return "", errors.New("ZIP 包包含无效文件路径")
	}
	clean := path.Clean(raw)
	if clean == "." || clean == ".." || strings.HasPrefix(clean, "../") || strings.Contains(clean, ":") || len(clean) > 512 {
		return "", errors.New("ZIP 包包含不安全的文件路径")
	}
	return clean, nil
}

func pathWithinRoot(name, root string) bool {
	return root == "" || name == root || strings.HasPrefix(name, root+"/")
}

func nearestSkillRoot(name string, roots []string) (string, bool) {
	for _, root := range roots {
		if pathWithinRoot(name, root) {
			return root, true
		}
	}
	return "", false
}

func inspectSkillArchive(reader *zip.Reader) (*AdminSkillArchivePreviewVO, error) {
	if reader == nil || len(reader.File) == 0 {
		return nil, errors.New("ZIP Skill 包为空")
	}
	if len(reader.File) > maxSkillArchiveEntries {
		return nil, fmt.Errorf("ZIP Skill 包最多包含 %d 个条目", maxSkillArchiveEntries)
	}

	entries := make([]skillArchiveEntry, 0, len(reader.File))
	rootsByKey := map[string]string{}
	seenPaths := map[string]struct{}{}
	var expanded uint64
	nonDirectoryFiles := 0
	for _, file := range reader.File {
		name, err := cleanSkillArchivePath(strings.TrimSuffix(file.Name, "/"))
		if err != nil {
			return nil, err
		}
		key := strings.ToLower(name)
		if _, duplicate := seenPaths[key]; duplicate {
			return nil, fmt.Errorf("ZIP 包包含重复路径 %q", name)
		}
		seenPaths[key] = struct{}{}
		if file.FileInfo().IsDir() {
			continue
		}
		nonDirectoryFiles++
		if file.Mode()&fs.ModeSymlink != 0 {
			return nil, fmt.Errorf("ZIP 包不支持符号链接文件 %q", name)
		}
		if file.Flags&0x1 != 0 {
			return nil, errors.New("不支持加密的 ZIP Skill 包")
		}
		if file.UncompressedSize64 > maxSkillArchiveExpandedBytes || expanded > maxSkillArchiveExpandedBytes-file.UncompressedSize64 {
			return nil, errors.New("ZIP Skill 包解压后超过 64 MB 安全限制")
		}
		expanded += file.UncompressedSize64
		entries = append(entries, skillArchiveEntry{file: file, name: name})
		if strings.EqualFold(path.Base(name), "SKILL.md") {
			root := path.Dir(name)
			if root == "." {
				root = ""
			}
			rootsByKey[strings.ToLower(root)] = root
		}
	}
	if len(rootsByKey) == 0 {
		return nil, errors.New("ZIP 包中没有找到 SKILL.md")
	}
	if len(rootsByKey) > 50 {
		return nil, errors.New("单个 ZIP 包最多包含 50 个 Skill")
	}

	roots := make([]string, 0, len(rootsByKey))
	for _, root := range rootsByKey {
		roots = append(roots, root)
	}
	// A nested Skill owns its own files; deepest root wins.
	sort.Slice(roots, func(i, j int) bool {
		if len(roots[i]) == len(roots[j]) {
			return roots[i] < roots[j]
		}
		return len(roots[i]) > len(roots[j])
	})

	packages := make(map[string]*AdminSkillArchivePackageVO, len(roots))
	seenRelative := make(map[string]map[string]struct{}, len(roots))
	for _, root := range roots {
		label := path.Base(root)
		if root == "" || label == "." {
			label = "Skill"
		}
		packages[root] = &AdminSkillArchivePackageVO{Root: label, PrimaryFilePath: "SKILL.md", Files: []AdminSkillFileDTO{}}
		seenRelative[root] = map[string]struct{}{}
	}

	acceptedFiles := 0
	totalTextBytes := uint64(0)
	actualTextBytes := 0
	for _, entry := range entries {
		ext := strings.ToLower(path.Ext(entry.name))
		if ext != ".md" && ext != ".txt" {
			continue
		}
		root, ok := nearestSkillRoot(entry.name, roots)
		if !ok {
			continue
		}
		relative := entry.name
		if root != "" {
			relative = strings.TrimPrefix(entry.name, root+"/")
		}
		cleanRelative, err := cleanSkillPath(relative)
		if err != nil {
			return nil, fmt.Errorf("Skill 文件路径无效: %s", relative)
		}
		relativeKey := strings.ToLower(cleanRelative)
		if _, duplicate := seenRelative[root][relativeKey]; duplicate {
			return nil, fmt.Errorf("Skill 包包含重复文件 %q", cleanRelative)
		}
		seenRelative[root][relativeKey] = struct{}{}
		if entry.file.UncompressedSize64 == 0 || entry.file.UncompressedSize64 > maxSkillImportFileBytes {
			return nil, fmt.Errorf("%s 超过 2 MB 单文件限制或内容为空", entry.name)
		}
		if strings.EqualFold(cleanRelative, "SKILL.md") && entry.file.UncompressedSize64 > maxSkillExecutablePromptBytes {
			return nil, fmt.Errorf("%s 超过 1 MB 主文件执行上限", entry.name)
		}
		if totalTextBytes > maxSkillImportTotalBytes-entry.file.UncompressedSize64 {
			return nil, errors.New("ZIP 包中的 Skill 文本文件合计超过 8 MB")
		}
		totalTextBytes += entry.file.UncompressedSize64
		stream, err := entry.file.Open()
		if err != nil {
			return nil, fmt.Errorf("无法读取 %s", entry.name)
		}
		content, readErr := io.ReadAll(io.LimitReader(stream, maxSkillImportFileBytes+1))
		closeErr := stream.Close()
		if readErr != nil || closeErr != nil || len(content) == 0 || len(content) > maxSkillImportFileBytes {
			return nil, fmt.Errorf("无法读取 %s", entry.name)
		}
		if !utf8.Valid(content) || strings.ContainsRune(string(content), '\x00') {
			return nil, fmt.Errorf("%s 不是有效的 UTF-8 文本", entry.name)
		}
		actualTextBytes += len(content)
		if actualTextBytes > maxSkillImportTotalBytes {
			return nil, errors.New("ZIP 包中的 Skill 文本文件合计超过 8 MB")
		}
		mime := "text/plain; charset=utf-8"
		if ext == ".md" {
			mime = "text/markdown; charset=utf-8"
		}
		packages[root].Files = append(packages[root].Files, AdminSkillFileDTO{
			Path: cleanRelative, Content: strings.TrimPrefix(string(content), "\ufeff"), MimeType: mime,
		})
		if len(packages[root].Files) > maxSkillImportFiles {
			return nil, fmt.Errorf("%s 最多包含 %d 个文本文件", packages[root].Root, maxSkillImportFiles)
		}
		acceptedFiles++
	}

	result := make([]AdminSkillArchivePackageVO, 0, len(roots))
	// Present packages by their archive path, independent of deepest-first file routing.
	sort.Strings(roots)
	for _, root := range roots {
		pkg := packages[root]
		sort.SliceStable(pkg.Files, func(i, j int) bool {
			if strings.EqualFold(pkg.Files[i].Path, "SKILL.md") {
				return true
			}
			if strings.EqualFold(pkg.Files[j].Path, "SKILL.md") {
				return false
			}
			return pkg.Files[i].Path < pkg.Files[j].Path
		})
		if len(pkg.Files) == 0 || !strings.EqualFold(pkg.Files[0].Path, "SKILL.md") {
			return nil, fmt.Errorf("%s 的 SKILL.md 无法读取", pkg.Root)
		}
		result = append(result, *pkg)
	}
	return &AdminSkillArchivePreviewVO{Packages: result, IgnoredFiles: nonDirectoryFiles - acceptedFiles}, nil
}
