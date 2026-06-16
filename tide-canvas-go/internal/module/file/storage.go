package file

import (
	"bytes"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/aliyun/aliyun-oss-go-sdk/oss"
	"github.com/google/uuid"
)

// DirectUploadTicket 前端直传凭据：对象键、预签名 PUT 地址、最终公网访问地址（对齐 record DirectUploadTicket）。
type DirectUploadTicket struct {
	Key       string
	UploadURL string
	FileURL   string
}

// Storage 存储抽象（对齐 StorageStrategy）。本地与 OSS 两实现。
//
// 直传相关方法（SupportsDirectUpload / Presign / FinalizeDirectUpload）仅 OSS 有意义，
// 本地实现返回不支持，由 service 据此让前端回退到服务器中转上传。
type Storage interface {
	// Upload 上传字节内容到 directory 子目录，返回存储相对路径（key）。
	// originalName 仅用于派生存储文件名；contentType 可空。
	Upload(data []byte, originalName, contentType, directory string) (string, error)
	// Delete 删除对象（best-effort，失败仅记日志不抛错）。
	Delete(filePath string)
	// PublicURL 由存储相对路径（key）得到访问地址（本地为 /uploads/...，OSS 为公网 HTTPS）。
	PublicURL(filePath string) string
	// Type 存储类型标识（local / oss），写入文件记录。
	Type() string

	// SupportsDirectUpload 是否支持前端直传到对象存储。仅 OSS 支持。
	SupportsDirectUpload() bool
	// Presign 生成前端直传凭据：在 directory 下为 originalName 生成对象键，
	// 返回绑定 contentType、expireSeconds 内有效的预签名 PUT 地址与最终公网地址。
	Presign(originalName, contentType, directory string, expireSeconds int64) (*DirectUploadTicket, error)
	// FinalizeDirectUpload 直传完成后收尾：校验对象确已上传、尽力设为公网可读，返回对象真实大小（字节）。
	// 对象不存在应返回错误。
	FinalizeDirectUpload(key, contentType string) (int64, error)
}

// errDirectUnsupported 本地存储不支持直传时的统一错误（对齐 UnsupportedOperationException）。
var errDirectUnsupported = fmt.Errorf("当前存储不支持前端直传")

// sanitizeKey 对象键文件名安全化：仅保留字母数字与 . _ -（对齐 OssStorageStrategy.sanitize）。
var sanitizeKey = regexp.MustCompile(`[^a-zA-Z0-9._-]`)

func sanitize(name string) string {
	if strings.TrimSpace(name) == "" {
		return "file"
	}
	return sanitizeKey.ReplaceAllString(name, "_")
}

// ---- 本地磁盘存储（默认）----

// LocalStorage 本地磁盘存储（对齐 LocalStorageStrategy）。
// 返回相对地址 /uploads/...，不可被外部中转站获取，仅适合本机预览。
type LocalStorage struct {
	// LocalDir 本地存储根目录（storage.local_dir）。
	LocalDir string
}

// NewLocalStorage 构造本地存储。
func NewLocalStorage(localDir string) *LocalStorage { return &LocalStorage{LocalDir: localDir} }

// Upload 落地到 LocalDir/directory 下，文件名 = 时间戳_安全化原名。
func (s *LocalStorage) Upload(data []byte, originalName, _ string, directory string) (string, error) {
	dirPath := filepath.Join(s.LocalDir, directory)
	if err := os.MkdirAll(dirPath, 0o755); err != nil {
		return "", fmt.Errorf("文件上传失败: %w", err)
	}
	fileName := fmt.Sprintf("%d_%s", time.Now().UnixMilli(), s.sanitizeLocal(originalName))
	target, err := s.resolveSafely(dirPath, fileName)
	if err != nil {
		return "", err
	}
	if err := os.WriteFile(target, data, 0o644); err != nil {
		return "", fmt.Errorf("文件上传失败: %w", err)
	}
	return directory + "/" + fileName, nil
}

// sanitizeLocal 本地文件名安全化：剥离目录部分、上跳与特殊字符，避免路径穿越/覆盖
// （对齐 LocalStorageStrategy.sanitize）。
func (s *LocalStorage) sanitizeLocal(name string) string {
	if strings.TrimSpace(name) == "" {
		return "file"
	}
	base := strings.ReplaceAll(name, "\\", "/")
	if slash := strings.LastIndex(base, "/"); slash >= 0 {
		base = base[slash+1:]
	}
	base = sanitizeKey.ReplaceAllString(base, "_")
	if base == "" || base == "." || base == ".." {
		return "file"
	}
	return base
}

// resolveSafely 落地路径必须落在目标目录内（防御性，sanitize 后正常已无穿越可能）。
func (s *LocalStorage) resolveSafely(dir, fileName string) (string, error) {
	resolved := filepath.Clean(filepath.Join(dir, fileName))
	cleanDir := filepath.Clean(dir)
	if resolved != cleanDir && !strings.HasPrefix(resolved, cleanDir+string(os.PathSeparator)) {
		return "", fmt.Errorf("非法文件名")
	}
	return resolved, nil
}

// Delete 删除本地文件（不存在忽略）。
func (s *LocalStorage) Delete(filePath string) {
	_ = os.Remove(filepath.Join(s.LocalDir, filePath))
}

// PublicURL 本地访问地址（静态资源前缀 /uploads）。
func (s *LocalStorage) PublicURL(filePath string) string { return "/uploads/" + filePath }

// Type 存储类型。
func (s *LocalStorage) Type() string { return "local" }

// SupportsDirectUpload 本地不支持直传。
func (s *LocalStorage) SupportsDirectUpload() bool { return false }

// Presign 本地不支持直传。
func (s *LocalStorage) Presign(string, string, string, int64) (*DirectUploadTicket, error) {
	return nil, errDirectUnsupported
}

// FinalizeDirectUpload 本地不支持直传。
func (s *LocalStorage) FinalizeDirectUpload(string, string) (int64, error) {
	return 0, errDirectUnsupported
}

// ---- 阿里云 OSS 存储 ----

// OSSStorage 阿里云 OSS 存储（对齐 OssStorageStrategy）。
//
// 上传写入公网可读对象，PublicURL 返回公网 HTTPS 地址，供图生图/视频参考把源图作为
// image_urls 交给中转站拉取（中转站要求公网可达 URL）。仅当 storage.kind=oss 时启用。
type OSSStorage struct {
	Endpoint        string
	AccessKeyID     string
	AccessKeySecret string
	Bucket          string
	// Prefix 桶内对象键前缀（目录），如 uploads/。
	Prefix string
	// CDNDomain 可选 CDN 自定义域名；留空按 https://{bucket}.{endpoint} 拼接。
	CDNDomain string

	mu     sync.Mutex
	client *oss.Client
}

// NewOSSStorage 构造 OSS 存储（客户端懒加载）。
func NewOSSStorage(endpoint, accessKeyID, accessKeySecret, bucket, prefix, cdnDomain string) *OSSStorage {
	return &OSSStorage{
		Endpoint:        endpoint,
		AccessKeyID:     accessKeyID,
		AccessKeySecret: accessKeySecret,
		Bucket:          bucket,
		Prefix:          prefix,
		CDNDomain:       cdnDomain,
	}
}

// clientOf 懒加载 OSS 客户端（线程安全双检锁，对齐 OssStorageStrategy.client()）。
func (s *OSSStorage) clientOf() (*oss.Client, error) {
	if s.client != nil {
		return s.client, nil
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.client != nil {
		return s.client, nil
	}
	cli, err := oss.New(s.Endpoint, s.AccessKeyID, s.AccessKeySecret)
	if err != nil {
		return nil, err
	}
	s.client = cli
	return cli, nil
}

// bucketOf 取业务桶句柄。
func (s *OSSStorage) bucketOf() (*oss.Bucket, error) {
	cli, err := s.clientOf()
	if err != nil {
		return nil, err
	}
	return cli.Bucket(s.Bucket)
}

// prefix 规范化对象键前缀：非空时确保以 / 结尾（对齐 OssStorageStrategy.prefix）。
func (s *OSSStorage) prefix() string {
	p := s.Prefix
	if strings.TrimSpace(p) == "" {
		return ""
	}
	if strings.HasSuffix(p, "/") {
		return p
	}
	return p + "/"
}

// Upload 上传字节到 OSS，并尽力设为公网可读（对齐 OssStorageStrategy.upload/uploadBytes）。
func (s *OSSStorage) Upload(data []byte, originalName, contentType, directory string) (string, error) {
	bkt, err := s.bucketOf()
	if err != nil {
		return "", fmt.Errorf("文件上传失败: %w", err)
	}
	fileName := fmt.Sprintf("%d_%s", time.Now().UnixMilli(), sanitize(originalName))
	key := s.prefix() + directory + "/" + fileName
	var opts []oss.Option
	if strings.TrimSpace(contentType) != "" {
		opts = append(opts, oss.ContentType(contentType))
	}
	if err := bkt.PutObject(key, bytes.NewReader(data), opts...); err != nil {
		return "", fmt.Errorf("文件上传失败: %w", err)
	}
	// 尽力将对象设为公网可读，确保中转站能直接拉取（桶禁用对象 ACL 时忽略失败）。
	_ = bkt.SetObjectACL(key, oss.ACLPublicRead)
	return key, nil
}

// Delete 删除 OSS 对象（best-effort）。
func (s *OSSStorage) Delete(filePath string) {
	bkt, err := s.bucketOf()
	if err != nil {
		return
	}
	_ = bkt.DeleteObject(filePath)
}

// PublicURL 由对象键得到公网访问地址（优先 CDN 域名）。
func (s *OSSStorage) PublicURL(filePath string) string {
	if strings.TrimSpace(s.CDNDomain) != "" {
		return strings.TrimRight(s.CDNDomain, "/") + "/" + filePath
	}
	host := strings.TrimRight(stripScheme(s.Endpoint), "/")
	return "https://" + s.Bucket + "." + host + "/" + filePath
}

// Type 存储类型。
func (s *OSSStorage) Type() string { return "oss" }

// SupportsDirectUpload OSS 支持直传。
func (s *OSSStorage) SupportsDirectUpload() bool { return true }

// Presign 生成直传预签名 PUT 地址（绑定 Content-Type 进签名）。
func (s *OSSStorage) Presign(originalName, contentType, directory string, expireSeconds int64) (*DirectUploadTicket, error) {
	bkt, err := s.bucketOf()
	if err != nil {
		return nil, err
	}
	fileName := fmt.Sprintf("%d_%s_%s", time.Now().UnixMilli(), shortUUID(), sanitize(originalName))
	key := s.prefix() + directory + "/" + fileName
	var opts []oss.Option
	if strings.TrimSpace(contentType) != "" {
		// 绑定 Content-Type 进签名：前端 PUT 时必须发送相同的 Content-Type，否则签名不匹配。
		opts = append(opts, oss.ContentType(contentType))
	}
	uploadURL, err := bkt.SignURL(key, oss.HTTPPut, expireSeconds, opts...)
	if err != nil {
		return nil, err
	}
	return &DirectUploadTicket{Key: key, UploadURL: uploadURL, FileURL: s.PublicURL(key)}, nil
}

// FinalizeDirectUpload 校验对象确已上传（不存在会报错），取真实大小，并尽力设为公网可读。
func (s *OSSStorage) FinalizeDirectUpload(key, _ string) (int64, error) {
	bkt, err := s.bucketOf()
	if err != nil {
		return 0, err
	}
	meta, err := bkt.GetObjectDetailedMeta(key)
	if err != nil {
		return 0, err
	}
	// 尽力设为公网可读，确保中转站可拉取（桶禁用对象 ACL 时忽略失败）。
	_ = bkt.SetObjectACL(key, oss.ACLPublicRead)
	cl := meta.Get("Content-Length")
	size, err := parseInt64(cl)
	if err != nil {
		return 0, fmt.Errorf("无法读取对象大小: %w", err)
	}
	return size, nil
}

// stripScheme 去掉 URL 前的 http:// 或 https://。
func stripScheme(s string) string {
	s = strings.TrimPrefix(s, "https://")
	s = strings.TrimPrefix(s, "http://")
	return s
}

// shortUUID 取 UUID v4 前 8 位（对齐 OSS presign 的 UUID.toString().substring(0,8)）。
func shortUUID() string {
	u := uuid.NewString()
	if len(u) >= 8 {
		return u[:8]
	}
	return u
}

// parseInt64 解析十进制字符串为 int64（用于读取 OSS 对象 Content-Length 头）。
func parseInt64(s string) (int64, error) {
	return strconv.ParseInt(strings.TrimSpace(s), 10, 64)
}
