package admin

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"path"
	"regexp"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"tidecanvas/internal/pkg/response"
	"tidecanvas/internal/pkg/safefetch"
)

// Remote import only reads public GitHub repositories. It never runs git,
// archive scripts or sends the administrator's JWT/API keys to GitHub.
const skillGitHubTimeout = 60 * time.Second

var (
	skillGitHubName   = regexp.MustCompile(`^[a-zA-Z0-9_.-]+$`)
	skillGitHubSHA    = regexp.MustCompile(`^[a-fA-F0-9]{40}$`)
	skillGitHubSlots  = make(chan struct{}, 4)
	skillGitHubClient = safefetch.NewClient(skillGitHubTimeout, skillGitHubDownloadURL)
)

type skillGitHubSource struct {
	Owner, Repo, Mode string
	Tail              []string
}

type skillGitHubPreview struct {
	AdminSkillArchivePreviewVO
	SourceURL string `json:"sourceUrl"`
	CommitSHA string `json:"commitSha"`
	Directory string `json:"directory"`
}

func parseSkillGitHubSource(raw string) (*skillGitHubSource, error) {
	if len(raw) > 2048 {
		return nil, errors.New("GitHub 地址过长")
	}
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || u.Scheme != "https" || u.User != nil || u.Port() != "" || u.Opaque != "" {
		return nil, errors.New("请输入完整的 GitHub HTTPS 仓库、目录或 SKILL.md 地址")
	}
	host := strings.ToLower(u.Host)
	if host != "github.com" && host != "www.github.com" && host != "raw.githubusercontent.com" {
		return nil, errors.New("仅支持 github.com 的公开仓库，不支持其他下载站点")
	}
	parts := strings.Split(strings.Trim(u.Path, "/"), "/")
	if len(parts) < 2 || !skillGitHubName.MatchString(parts[0]) || !skillGitHubName.MatchString(parts[1]) {
		return nil, errors.New("GitHub 地址缺少有效的仓库所有者或仓库名")
	}
	for _, part := range parts {
		if part == "" || part == "." || part == ".." || strings.ContainsAny(part, "\\:%?#") || strings.IndexFunc(part, func(r rune) bool { return r < 32 || r == 127 }) >= 0 {
			return nil, errors.New("GitHub 地址包含无效路径")
		}
	}
	source := &skillGitHubSource{Owner: parts[0], Repo: strings.TrimSuffix(parts[1], ".git")}
	if source.Repo == "" {
		return nil, errors.New("GitHub 仓库名不能为空")
	}
	if host == "raw.githubusercontent.com" {
		source.Mode, source.Tail = "blob", parts[2:]
	} else if len(parts) > 2 {
		source.Mode, source.Tail = parts[2], parts[3:]
	} else {
		return source, nil
	}
	if (source.Mode != "tree" && source.Mode != "blob") || len(source.Tail) == 0 || len(source.Tail) > 12 {
		return nil, errors.New("请使用仓库首页、tree 目录或 SKILL.md 文件地址，不支持搜索、Issue 和发布页")
	}
	if source.Mode == "blob" && (len(source.Tail) < 2 || source.Tail[len(source.Tail)-1] != "SKILL.md") {
		return nil, errors.New("文件地址必须指向 SKILL.md；引用资料会从它的目录一起读取")
	}
	return source, nil
}

func skillGitHubDownloadURL(u *url.URL) error {
	if u == nil || u.Scheme != "https" || u.User != nil || u.Port() != "" || (u.Host != "api.github.com" && u.Host != "codeload.github.com") {
		return errors.New("GitHub 请求重定向到了不允许的地址")
	}
	return nil
}

type skillGitHubHTTPError struct{ status int }

func (e *skillGitHubHTTPError) Error() string {
	switch e.status {
	case 404:
		return "找不到 GitHub 仓库、分支或目录；目前只支持公开仓库，私有仓库请下载 ZIP 后导入"
	case 401:
		return "GitHub 仓库需要登录，请下载 ZIP 后导入"
	case 403, 429:
		return "GitHub 访问受限或请求额度已用完，请稍后重试，或下载 ZIP 后导入"
	case 422:
		return "GitHub 分支或提交不存在，请检查地址"
	default:
		return fmt.Sprintf("GitHub 暂时无法读取（HTTP %d），请稍后重试", e.status)
	}
}

func readSkillGitHubURL(ctx context.Context, client *http.Client, target string, limit int64) ([]byte, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, target, nil)
	if err != nil || skillGitHubDownloadURL(req.URL) != nil {
		return nil, errors.New("GitHub 请求地址无效")
	}
	req.Header.Set("User-Agent", "FlowLight-Skill-Importer")
	req.Header.Set("Accept", "application/vnd.github+json")
	resp, err := client.Do(req)
	if err != nil {
		if ctx.Err() != nil {
			return nil, errors.New("GitHub 读取已取消或超时，请重试或使用 ZIP 导入")
		}
		return nil, errors.New("无法连接 GitHub，请检查服务器网络或改用 ZIP 导入")
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, &skillGitHubHTTPError{resp.StatusCode}
	}
	if resp.ContentLength > limit {
		return nil, errors.New("GitHub 仓库文件过大，请将所需 Skill 单独打包后导入（ZIP 最大 16 MB）")
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, limit+1))
	if err != nil {
		return nil, errors.New("GitHub 响应读取失败，请重试")
	}
	if int64(len(body)) > limit {
		return nil, errors.New("GitHub 仓库文件过大，请将所需 Skill 单独打包后导入（ZIP 最大 16 MB）")
	}
	return body, nil
}

func resolveSkillGitHubCommit(ctx context.Context, client *http.Client, source *skillGitHubSource) (string, string, error) {
	base := "https://api.github.com/repos/" + source.Owner + "/" + source.Repo + "/commits/"
	lookup := func(ref string) (string, error) {
		// Only identity is needed; bound the changed-file portion of large commits.
		body, err := readSkillGitHubURL(ctx, client, base+url.PathEscape(ref)+"?per_page=1", 2<<20)
		if err != nil {
			return "", err
		}
		var commit struct {
			SHA string `json:"sha"`
		}
		if json.Unmarshal(body, &commit) != nil || !skillGitHubSHA.MatchString(commit.SHA) {
			return "", errors.New("GitHub 返回了无效的提交信息")
		}
		return commit.SHA, nil
	}
	if source.Mode == "" {
		sha, err := lookup("HEAD")
		return sha, "", err
	}
	// GitHub refs may contain slashes. Resolve the longest existing ref instead
	// of treating a branch like feature/review as branch=feature, directory=review.
	max := len(source.Tail)
	if source.Mode == "blob" {
		max--
	}
	for n := max; n > 0; n-- {
		sha, err := lookup(strings.Join(source.Tail[:n], "/"))
		if err == nil {
			directory := strings.Join(source.Tail[n:], "/")
			if source.Mode == "blob" {
				directory = path.Dir(directory)
				if directory == "." {
					directory = ""
				}
			}
			return sha, directory, nil
		}
		var status *skillGitHubHTTPError
		if !errors.As(err, &status) || (status.status != 404 && status.status != 422) {
			return "", "", err
		}
	}
	return "", "", &skillGitHubHTTPError{404}
}

// GitHub adds a synthetic repo-SHA wrapper. Strip only that directory; retain
// real Skill directory names so the existing name/directory check still runs.
func inspectSkillGitHubArchive(reader *zip.Reader, directory string) (*AdminSkillArchivePreviewVO, error) {
	if len(reader.File) > 20000 {
		return nil, errors.New("GitHub 仓库条目过多，请单独打包所需 Skill 后导入")
	}
	filtered := &zip.Reader{}
	wrapper := ""
	for _, file := range reader.File {
		name, err := cleanSkillArchivePath(strings.TrimSuffix(file.Name, "/"))
		if err != nil {
			return nil, err
		}
		root, relative, hasPath := strings.Cut(name, "/")
		if wrapper == "" {
			wrapper = root
		}
		if root != wrapper {
			return nil, errors.New("GitHub 压缩包目录结构无效")
		}
		if !hasPath || !pathWithinRoot(relative, directory) {
			continue
		}
		copy := *file
		copy.Name = relative
		if file.FileInfo().IsDir() {
			copy.Name += "/"
		}
		filtered.File = append(filtered.File, &copy)
	}
	if len(filtered.File) == 0 {
		return nil, errors.New("GitHub 地址指定的目录不存在或为空")
	}
	return inspectSkillArchive(filtered)
}

func loadSkillGitHub(ctx context.Context, client *http.Client, raw string) (*skillGitHubPreview, error) {
	source, err := parseSkillGitHubSource(raw)
	if err != nil {
		return nil, err
	}
	sha, directory, err := resolveSkillGitHubCommit(ctx, client, source)
	if err != nil {
		return nil, err
	}
	archive, err := readSkillGitHubURL(ctx, client, "https://codeload.github.com/"+source.Owner+"/"+source.Repo+"/zip/"+sha, maxSkillArchiveBytes)
	if err != nil {
		return nil, err
	}
	reader, err := zip.NewReader(bytes.NewReader(archive), int64(len(archive)))
	if err != nil {
		return nil, errors.New("GitHub 没有返回有效的 ZIP，请稍后重试")
	}
	preview, err := inspectSkillGitHubArchive(reader, directory)
	if err != nil {
		return nil, err
	}
	sourceURL := "https://github.com/" + source.Owner + "/" + source.Repo + "/tree/" + sha
	if directory != "" {
		for _, part := range strings.Split(directory, "/") {
			sourceURL += "/" + url.PathEscape(part)
		}
	}
	return &skillGitHubPreview{AdminSkillArchivePreviewVO: *preview, SourceURL: sourceURL, CommitSHA: sha, Directory: directory}, nil
}

func (h *skillsHandler) previewGitHubSkill(c *gin.Context) {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 4<<10)
	var dto struct {
		URL string `json:"url"`
	}
	if err := decodeSkillJSON(c.Request.Body, &dto); err != nil {
		response.Fail(c, response.CodeBadRequest, "GitHub 地址请求无效或过大")
		return
	}
	if _, err := parseSkillGitHubSource(dto.URL); err != nil {
		response.Fail(c, response.CodeBadRequest, err.Error())
		return
	}
	select {
	case skillGitHubSlots <- struct{}{}:
		defer func() { <-skillGitHubSlots }()
	default:
		response.Fail(c, response.CodeBadRequest, "GitHub 导入正在处理中，请稍后重试")
		return
	}
	ctx, cancel := context.WithTimeout(c.Request.Context(), skillGitHubTimeout)
	defer cancel()
	preview, err := loadSkillGitHub(ctx, skillGitHubClient, dto.URL)
	if err != nil {
		response.Fail(c, response.CodeBadRequest, err.Error())
		return
	}
	response.OK(c, preview)
}
