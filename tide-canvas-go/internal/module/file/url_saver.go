package file

import (
	"errors"
	"fmt"
	"io"
	"net/http"
	"path"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/sirupsen/logrus"
)

// URLSaver 把外部（上游临时）URL 的内容下载并转存到自有存储后端，返回自有持久化 URL。
//
// 满足 ai.FileSaver（SaveFromURL(userID int64, url string) (string, error)）：用于把 AI 上游
// （中转站/Runware）返回的临时媒体 URL 持久化到 OSS，避免上游 URL 过期导致结果不可访问。
// 与 file.Service.SaveFromURL 不同——后者只把 URL 登记为素材引用，不下载转存。
type URLSaver struct {
	store    Storage
	maxBytes int64
	logger   *logrus.Logger
}

// NewURLSaver 构造。maxBytes<=0 时默认 100MB。
func NewURLSaver(store Storage, maxBytes int64, logger *logrus.Logger) *URLSaver {
	return &URLSaver{store: store, maxBytes: maxBytes, logger: logger}
}

// SaveFromURL 下载 rawURL 内容并上传到存储后端，返回新的公网 URL。
func (s *URLSaver) SaveFromURL(userID int64, rawURL string) (string, error) {
	rawURL = strings.TrimSpace(rawURL)
	if rawURL == "" {
		return "", errors.New("empty url")
	}
	if !strings.HasPrefix(rawURL, "http://") && !strings.HasPrefix(rawURL, "https://") {
		return "", errors.New("unsupported url scheme") // 仅转存 http(s)，挡住 data:/file: 等
	}
	limit := s.maxBytes
	if limit <= 0 {
		limit = 100 << 20 // 100MB
	}

	client := &http.Client{Timeout: 60 * time.Second}
	resp, err := client.Get(rawURL)
	if err != nil {
		return "", err
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("download upstream asset failed: status %d", resp.StatusCode)
	}

	// 多读 1 字节用于判断是否超限。
	data, err := io.ReadAll(io.LimitReader(resp.Body, limit+1))
	if err != nil {
		return "", err
	}
	if int64(len(data)) > limit {
		return "", fmt.Errorf("upstream asset too large (> %d bytes)", limit)
	}

	contentType := resp.Header.Get("Content-Type")
	if i := strings.IndexByte(contentType, ';'); i >= 0 {
		contentType = strings.TrimSpace(contentType[:i])
	}
	if contentType == "" {
		contentType = "application/octet-stream"
	}

	key, err := s.store.Upload(data, assetName(rawURL, contentType), contentType, "ai")
	if err != nil {
		return "", err
	}
	saved := s.store.PublicURL(key)
	if s.logger != nil {
		s.logger.Infof("[file] AI 结果转存: userId=%d, %s -> %s", userID, rawURL, saved)
	}
	return saved, nil
}

// assetName 生成转存文件名：uuid + 扩展名（优先按 contentType，回退原 URL 后缀）。
func assetName(rawURL, contentType string) string {
	ext := extByContentType(contentType)
	if ext == "" {
		clean := rawURL
		if i := strings.IndexAny(clean, "?#"); i >= 0 {
			clean = clean[:i]
		}
		ext = path.Ext(clean)
	}
	return uuid.NewString() + ext
}

func extByContentType(ct string) string {
	switch ct {
	case "image/png":
		return ".png"
	case "image/jpeg", "image/jpg":
		return ".jpg"
	case "image/gif":
		return ".gif"
	case "image/webp":
		return ".webp"
	case "video/mp4":
		return ".mp4"
	case "video/webm":
		return ".webm"
	case "audio/mpeg", "audio/mp3":
		return ".mp3"
	}
	return ""
}
