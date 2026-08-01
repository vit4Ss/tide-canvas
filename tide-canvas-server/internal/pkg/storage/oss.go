package storage

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/url"
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

	publicBase     string // base for frontend-facing URLs (CDN or regional)
	regionalBase   string // bucket virtual-host on the regional endpoint
	accelerateBase string // bucket host on the transfer-acceleration endpoint
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
	}, nil
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
func (o *OSSStorage) Presign(ctx context.Context, key, contentType string) (PresignResult, error) {
	var opts []oss.Option
	if strings.TrimSpace(contentType) != "" {
		opts = append(opts, oss.ContentType(contentType))
	}
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
	}, nil
}

// UpstreamURL rewrites a public asset URL to the transfer-acceleration host so an
// overseas upstream supplier can fetch it cross-border without timing out. Only
// URLs on this bucket's public/regional host are rewritten; anything else (e.g. a
// relay-hosted generated image) is returned unchanged.
func (o *OSSStorage) UpstreamURL(u string) string {
	if o.accelerateBase == "" || u == "" {
		return u
	}
	for _, base := range []string{o.publicBase, o.regionalBase} {
		if base != "" && strings.HasPrefix(u, base+"/") {
			return o.accelerateBase + strings.TrimPrefix(u, base)
		}
	}
	return u
}

// FetchHosts returns every host that may serve this bucket's assets: the public
// (CDN or regional) host, the regional host and the acceleration host. Used as
// the self-site allowlist for server-side fetches (chat document attachments).
func (o *OSSStorage) FetchHosts() []string {
	return hostsOf(o.publicBase, o.regionalBase, o.accelerateBase)
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
	if u == "" {
		return "", false
	}
	parsed, err := url.Parse(u)
	if err != nil || parsed.Host == "" {
		return "", false
	}
	own := false
	for _, h := range o.FetchHosts() {
		if h == parsed.Host {
			own = true
			break
		}
	}
	if !own {
		return "", false
	}
	key := strings.TrimPrefix(parsed.Path, "/")
	if o.prefix != "" {
		if !strings.HasPrefix(key, o.prefix+"/") {
			return "", false
		}
	}
	if key == "" {
		return "", false
	}
	return o.publicBase + "/" + key, true
}

// PublicRewrites maps the regional base onto the public base when they differ
// (i.e. a CDN domain is configured), so URLs persisted before the CDN existed
// are served on the current public base at read time. The acceleration host is
// intentionally excluded — presign responses carry signed URLs on it.
func (o *OSSStorage) PublicRewrites() [][2]string {
	if o.publicBase == "" || o.regionalBase == "" || o.publicBase == o.regionalBase {
		return nil
	}
	return [][2]string{{o.regionalBase, o.publicBase}}
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
