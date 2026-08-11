package storage

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/aliyun/aliyun-oss-go-sdk/oss"

	"tidecanvas/internal/config"
)

// oss.go is the Alibaba Cloud OSS-backed StorageStrategy. Every object key is
// namespaced under a configurable project prefix (e.g. "canvas/uploads/") so a
// bucket shared across projects never collides. Public URLs are built from the
// CDN domain when set, else the bucket's regional virtual-host. When a
// transfer-acceleration host is configured it is used for (a) server-side
// uploads and direct-upload presigns (cross-border upload speedup) and (b)
// rewriting URLs handed to overseas upstream suppliers (UpstreamURL) so
// cross-border downloads do not time out.

// presignTTL bounds a direct-upload signed URL.
const presignTTL = 10 * time.Minute

// OSSStorage persists blobs to an OSS bucket.
type OSSStorage struct {
	bucket *oss.Bucket
	prefix string // normalized, no leading slash, trailing slash kept off

	publicBase     string   // base for frontend-facing URLs (CDN or regional)
	regionalBase   string   // bucket virtual-host on the regional endpoint
	accelerateBase string   // bucket host on the transfer-acceleration endpoint
	legacyBases    []string // 历史存储域名(老数据遗留),读时一并改写为 publicBase
}

// NewOSSStorage builds an OSS strategy from the config. It validates the minimum
// required fields and resolves the public / accelerate URL bases.
func NewOSSStorage(cfg config.StorageConfig) (*OSSStorage, error) {
	endpoint := strings.TrimSpace(cfg.Endpoint)
	bucketName := strings.TrimSpace(cfg.Bucket)
	if endpoint == "" || bucketName == "" || strings.TrimSpace(cfg.AccessKey) == "" || strings.TrimSpace(cfg.SecretKey) == "" {
		return nil, errors.New("storage: oss requires endpoint, bucket, accessKey and secretKey")
	}

	regionalBase := bucketVirtualHost(endpoint, bucketName)
	publicBase := regionalBase
	if cdn := normalizeBase(cfg.CDNDomain); cdn != "" {
		publicBase = cdn
	}
	accelerateBase := normalizeBase(cfg.AccelerateDomain)

	// 配了传输加速域名时,上传/删除/直传签名统一走加速 endpoint(跨境提速);
	// 展示 URL 不受影响,仍由 publicBase(CDN 优先)决定。
	clientEndpoint := endpoint
	var clientOpts []oss.ClientOption
	if accelerateBase != "" {
		clientEndpoint, clientOpts = accelerateClient(accelerateBase, bucketName)
	}
	client, err := oss.New(clientEndpoint, cfg.AccessKey, cfg.SecretKey, clientOpts...)
	if err != nil {
		return nil, fmt.Errorf("storage: oss client: %w", err)
	}
	bucket, err := client.Bucket(bucketName)
	if err != nil {
		return nil, fmt.Errorf("storage: oss bucket: %w", err)
	}

	return &OSSStorage{
		bucket:         bucket,
		prefix:         strings.Trim(strings.TrimSpace(cfg.Prefix), "/"),
		publicBase:     publicBase,
		regionalBase:   regionalBase,
		accelerateBase: accelerateBase,
		legacyBases:    parseLegacyHosts(cfg.LegacyHosts),
	}, nil
}

// parseLegacyHosts 把逗号分隔的历史域名规整成 scheme://host 形态(跳过空项)。
func parseLegacyHosts(raw string) []string {
	var out []string
	for _, h := range strings.Split(raw, ",") {
		if b := normalizeBase(h); b != "" {
			out = append(out, b)
		}
	}
	return out
}

// Type returns "oss".
func (o *OSSStorage) Type() string { return "oss" }

// objectKey applies the project prefix to a cleaned storage key.
func (o *OSSStorage) objectKey(key string) string {
	rel := cleanKey(key)
	if o.prefix == "" {
		return rel
	}
	return o.prefix + "/" + rel
}

// Save uploads the reader's bytes to the prefixed object key and returns the
// public URL.
func (o *OSSStorage) Save(ctx context.Context, key string, r io.Reader, contentType string) (string, error) {
	rel := cleanKey(key)
	if rel == "" {
		return "", errors.New("storage: empty key")
	}
	var opts []oss.Option
	if strings.TrimSpace(contentType) != "" {
		opts = append(opts, oss.ContentType(contentType))
	}
	if err := o.bucket.PutObject(o.objectKey(key), r, opts...); err != nil {
		return "", fmt.Errorf("storage: oss put: %w", err)
	}
	return o.URL(key), nil
}

// Delete removes the object; a missing object is treated as success.
func (o *OSSStorage) Delete(ctx context.Context, key string) error {
	rel := cleanKey(key)
	if rel == "" {
		return nil
	}
	if err := o.bucket.DeleteObject(o.objectKey(key)); err != nil {
		return fmt.Errorf("storage: oss delete: %w", err)
	}
	return nil
}

// URL returns the public (frontend-facing) URL for key.
func (o *OSSStorage) URL(key string) string {
	return o.publicBase + "/" + o.objectKey(key)
}

// Presign returns a direct-to-OSS upload grant (a signed PUT URL). The frontend
// PUTs the bytes straight to OSS, then registers the file by Key/FileURL.

func (o *OSSStorage) Presign(ctx context.Context, key, contentType string, expectedSize int64) (PresignResult, error) {
	_ = ctx
	if expectedSize <= 0 {
		return PresignResult{}, errors.New("storage: expected upload size must be positive")
	}
	var opts []oss.Option
	if strings.TrimSpace(contentType) != "" {
		opts = append(opts, oss.ContentType(contentType))
	}
	// The signed x-oss-forbid-overwrite header makes each random key immutable:
	// replaying the URL cannot replace an asset after it has been registered.
	opts = append(opts, oss.ForbidOverWrite(true), oss.ContentLength(expectedSize))
	signed, err := o.bucket.SignURL(o.objectKey(key), oss.HTTPPut, int64(presignTTL/time.Second), opts...)
	if err != nil {
		return PresignResult{}, fmt.Errorf("storage: oss sign: %w", err)
	}
	return PresignResult{
		Direct:      true,
		UploadURL:   signed,
		Key:         cleanKey(key),
		FileURL:     o.URL(key),
		ContentType: contentType,
		Headers: map[string]string{
			"Content-Type":           contentType,
			"x-oss-forbid-overwrite": "true",
		},
	}, nil
}

// Stat reads metadata from OSS itself, closing the trust boundary between a
// browser PUT and the subsequent asset registration request.
func (o *OSSStorage) Stat(ctx context.Context, key string) (ObjectMeta, error) {
	_ = ctx
	meta, err := o.bucket.GetObjectDetailedMeta(o.objectKey(key))
	if err != nil {
		return ObjectMeta{}, fmt.Errorf("storage: oss stat: %w", err)
	}
	size, err := strconv.ParseInt(strings.TrimSpace(meta.Get("Content-Length")), 10, 64)
	if err != nil || size < 0 {
		return ObjectMeta{}, errors.New("storage: oss stat returned invalid content length")
	}
	return ObjectMeta{Size: size, ContentType: strings.TrimSpace(meta.Get("Content-Type"))}, nil
}

// UpstreamURL rewrites a public asset URL to the transfer-acceleration host so an
// overseas upstream supplier can fetch it cross-border without timing out. URLs
// on any of this bucket's known hosts (public/regional/acceleration/legacy) are
// rewritten; anything else (e.g. a relay-hosted generated image) is returned
// unchanged.
func (o *OSSStorage) UpstreamURL(u string) string {
	if o.accelerateBase == "" || u == "" {
		return u
	}
	bases := append([]string{o.publicBase, o.regionalBase}, o.legacyBases...)
	for _, base := range bases {
		if base != "" && strings.HasPrefix(u, base+"/") {
			return o.accelerateBase + strings.TrimPrefix(u, base)
		}
	}
	return u
}

// FetchHosts returns every host that may serve this bucket's assets: the public
// (CDN or regional) host, the regional host, the acceleration host, and any
// configured legacy hosts (老数据里的历史域名,服务端回源抓取也要放行——
// 否则带老域名的文档附件会被 SSRF 白名单误杀). Used as the self-site
// allowlist for server-side fetches (chat document attachments).
func (o *OSSStorage) FetchHosts() []string {
	bases := append([]string{o.publicBase, o.regionalBase, o.accelerateBase}, o.legacyBases...)
	return hostsOf(bases...)
}

// OwnsURL reports whether u already points at an object under this project's
// prefix in our own bucket — on ANY serving host variant (public/CDN/regional/
// acceleration, since the relay hands back whichever its own config produced).
// The canonical return re-bases the object key onto the current publicBase and
// drops the query, so persisted display URLs stay uniform regardless of the
// inbound host. URLs on our hosts but OUTSIDE the project prefix (e.g. the
// relay's own uploads/ directory in the shared bucket) are NOT ours: their
// lifecycle belongs to someone else, so callers must still copy them.
func (o *OSSStorage) OwnsURL(u string) (string, bool) {
	bases := append([]string{o.publicBase, o.regionalBase, o.accelerateBase}, o.legacyBases...)
	key, ok := ownedObjectKey(u, bases, o.prefix)
	if !ok {
		return "", false
	}
	return canonicalObjectURL(o.publicBase, key)
}

// DeleteURL removes only an object whose URL is owned by this bucket/prefix.
// Unknown or third-party URLs are ignored rather than becoming a delete oracle.
func (o *OSSStorage) DeleteURL(ctx context.Context, raw string) error {
	bases := append([]string{o.publicBase, o.regionalBase, o.accelerateBase}, o.legacyBases...)
	key, ok := ownedObjectKey(raw, bases, o.prefix)
	if !ok {
		return nil
	}
	return o.Delete(ctx, key)
}

// PublicRewrites maps every host that may appear in persisted asset URLs onto
// the current public base: the regional host, the acceleration host (chat 附件
// 以它落日志), and any configured legacy hosts (老桶/老域名)。配了 CDN
// (publicBase ≠ regionalBase)才启用——响应层由此实现「配置一处,读时统一拼
// 当前 CDN」,换域名/换桶零数据迁移。
//
// ⚠️ 加速域名签名 URL(presign 直传)绝不能被改写——中间件对 presign 路由
// 整体豁免(见 middleware.DisplayURL),所以把 accelerate 放进这里是安全的。
func (o *OSSStorage) PublicRewrites() [][2]string {
	if o.publicBase == "" || o.regionalBase == "" || o.publicBase == o.regionalBase {
		return nil
	}
	out := [][2]string{{o.regionalBase, o.publicBase}}
	if o.accelerateBase != "" && o.accelerateBase != o.publicBase {
		out = append(out, [2]string{o.accelerateBase, o.publicBase})
	}
	for _, b := range o.legacyBases {
		if b != "" && b != o.publicBase && b != o.regionalBase && b != o.accelerateBase {
			out = append(out, [2]string{b, o.publicBase})
		}
	}
	return out
}

// accelerateClient 把配置的加速域名转成 SDK 的 endpoint。标准形态
// "https://bucket.oss-accelerate.aliyuncs.com" 剥掉 bucket 前缀即可（SDK 会自己
// 拼回）；host 前缀与 bucket 不一致（配置笔误，或自定义加速域）时按 CNAME
// 处理——SDK 不再拼 bucket，避免造出 "bucket.bucket.oss-accelerate..." 的坏 host。
func accelerateClient(base, bucket string) (endpoint string, opts []oss.ClientOption) {
	scheme, host := splitScheme(base)
	if strings.HasPrefix(host, bucket+".") {
		return scheme + "://" + strings.TrimPrefix(host, bucket+"."), nil
	}
	return scheme + "://" + host, []oss.ClientOption{oss.UseCname(true)}
}

// bucketVirtualHost builds the bucket's regional virtual-host base
// (scheme://bucket.endpoint-host) from an endpoint like
// "https://oss-cn-shanghai.aliyuncs.com".
func bucketVirtualHost(endpoint, bucket string) string {
	scheme, host := splitScheme(endpoint)
	return scheme + "://" + bucket + "." + host
}

// normalizeBase returns a scheme+host base (no trailing slash) for a configured
// domain, defaulting the scheme to https. Empty input yields "".
func normalizeBase(domain string) string {
	domain = strings.TrimSpace(domain)
	if domain == "" {
		return ""
	}
	scheme, host := splitScheme(domain)
	return scheme + "://" + strings.TrimRight(host, "/")
}

// splitScheme separates a URL-ish string into (scheme, host[+path]) defaulting
// the scheme to https when absent.
func splitScheme(s string) (scheme, host string) {
	s = strings.TrimSpace(s)
	if u, err := url.Parse(s); err == nil && u.Scheme != "" && u.Host != "" {
		return u.Scheme, u.Host + strings.TrimRight(u.Path, "/")
	}
	return "https", strings.TrimRight(strings.TrimPrefix(strings.TrimPrefix(s, "http://"), "https://"), "/")
}
