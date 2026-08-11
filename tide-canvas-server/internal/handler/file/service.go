package file

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"path"
	"strings"
	"time"

	"go.uber.org/zap"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"tidecanvas/internal/app"
	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/idgen"
	"tidecanvas/internal/pkg/logger"
	"tidecanvas/internal/pkg/storage"
)

// Limits and classification constants.
const (
	// maxFileSize caps a single uploaded/fetched file at 100 MiB.
	maxFileSize = 100 << 20
	// saveFromURLTimeout bounds the server-side fetch of a remote asset.
	saveFromURLTimeout     = 60 * time.Second
	directUploadGrantTTL   = 10 * time.Minute
	assetCategoryGeneral   = "general"
	assetCategoryCharacter = "character"
	assetCategoryScene     = "scene"
)

// Domain errors mapped to business codes by the HTTP layer.
var (
	errFileNotFound        = errors.New("file not found")
	errFileForbidden       = errors.New("not allowed to access this file")
	errFileTooLarge        = errors.New("file size exceeds the limit")
	errFileTypeRejected    = errors.New("file type is not allowed")
	errInvalidCategory     = errors.New("invalid asset category")
	errEmptyFile           = errors.New("empty file")
	errBadURL              = errors.New("invalid url")
	errFetchFailed         = errors.New("failed to fetch remote file")
	errStorageInsufficient = errors.New("storage quota is insufficient")
	errUploadGrantInvalid  = errors.New("direct upload grant is invalid or expired")
	errUploadMismatch      = errors.New("uploaded object does not match its grant")
)

// service holds file domain business logic.
type service struct {
	repo         *repo
	store        storage.StorageStrategy
	storageScope string
	httpcli      *http.Client
}

func newService(d *app.Deps) *service {
	storageScope := ""
	if d != nil && d.Cfg != nil {
		storageScope = storage.ScopeID(d.Cfg.Storage)
	}
	return &service{
		repo:         newRepo(d.DB),
		store:        d.Storage,
		storageScope: storageScope,
		httpcli:      newRemoteAssetClient(),
	}
}

// uploadInput carries the bytes + metadata for a server-mediated upload.
type uploadInput struct {
	OriginalName string
	ContentType  string
	FileTypeHint string // optional client hint ("image"|"video"|"other")
	CategoryHint string // optional business category ("general"|"character"|"scene")
	Size         int64  // -1 if unknown (streamed)
	Reader       io.Reader
}

// upload persists a single file to storage and records it. ownerID owns the file.
func (s *service) upload(ctx context.Context, ownerID idgen.ID, in uploadInput) (*FileVO, error) {
	if in.Reader == nil {
		return nil, errEmptyFile
	}
	if in.Size > maxFileSize {
		return nil, errFileTooLarge
	}

	ct := normalizeContentType(in.ContentType, in.OriginalName)
	if activeContentRejected(ct, in.OriginalName) {
		return nil, errFileTypeRejected
	}
	ftype := classify(in.FileTypeHint, ct, in.OriginalName)
	if !typeAllowed(ftype) {
		return nil, errFileTypeRejected
	}

	key := buildKey(ownerID, ftype, in.OriginalName)
	category, err := assetCategoryForFile(in.CategoryHint, ftype)
	if err != nil {
		return nil, err
	}

	// Wrap with a hard size limit so streamed uploads can't exceed the cap.
	limited := io.LimitReader(in.Reader, maxFileSize+1)
	counter := &countingReader{r: limited}

	url, err := s.store.Save(ctx, key, counter, ct)
	if err != nil {
		return nil, fmt.Errorf("store save: %w", err)
	}
	if counter.n > maxFileSize {
		_ = s.store.Delete(ctx, key)
		return nil, errFileTooLarge
	}
	if counter.n == 0 {
		_ = s.store.Delete(ctx, key)
		return nil, errEmptyFile
	}

	f := &model.File{
		ID:           idgen.Next(),
		OwnerID:      ownerID,
		OriginalName: fallbackName(in.OriginalName, ftype),
		StorageKey:   key,
		FileUrl:      url,
		FileSize:     counter.n,
		FileType:     ftype,
		Category:     category,
		MimeType:     ct,
		StorageType:  s.store.Type(),
		CreateTime:   time.Now(),
	}
	if err := s.createFileWithQuota(ctx, f); err != nil {
		_ = s.store.Delete(ctx, key)
		return nil, err
	}
	vo := toFileVO(f)
	return &vo, nil
}

// presign returns a direct-upload grant. For local storage Direct is false, so
// the frontend (uploadFileSmart) falls back to the server-mediated /upload path.
// NOTE: keep Direct=false for local — the contract relies on the fallback.
func (s *service) presign(ctx context.Context, ownerID idgen.ID, dto presignDTO) (*FilePresignVO, error) {
	if dto.Size <= 0 {
		return nil, errEmptyFile
	}
	if dto.Size > maxFileSize {
		return nil, errFileTooLarge
	}
	if len([]byte(strings.TrimSpace(dto.Filename))) > 512 {
		return nil, errBadURL
	}
	ct := normalizeContentType(dto.ContentType, dto.Filename)
	if len(ct) > 128 {
		return nil, errFileTypeRejected
	}
	if activeContentRejected(ct, dto.Filename) {
		return nil, errFileTypeRejected
	}
	ftype := classify(dto.FileType, ct, dto.Filename)
	if !typeAllowed(ftype) {
		return nil, errFileTypeRejected
	}
	category, err := assetCategoryForFile(dto.Category, ftype)
	if err != nil {
		return nil, err
	}
	key := buildKey(ownerID, ftype, dto.Filename)

	// Local storage deliberately returns Direct=false and uses the normal
	// multipart path; it does not need a durable direct-upload grant.
	if s.store.Type() != "oss" {
		res, err := s.store.Presign(ctx, key, ct, dto.Size)
		if err != nil {
			return nil, err
		}
		vo := toPresignVO(res)
		return &vo, nil
	}

	now := time.Now()
	grant := &model.FileUploadGrant{
		ID:           idgen.Next(),
		OwnerID:      ownerID,
		StorageKey:   key,
		StorageScope: s.storageScope,
		OriginalName: fallbackName(strings.TrimSpace(dto.Filename), ftype),
		ExpectedSize: dto.Size,
		FileType:     ftype,
		Category:     category,
		ContentType:  ct,
		ExpiresAt:    now.Add(directUploadGrantTTL),
		CreateTime:   now,
	}
	if err := s.repo.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var user model.User
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&user, "id = ?", ownerID).Error; err != nil {
			return err
		}
		if user.StorageQuota > 0 {
			var reserved int64
			if err := tx.Model(&model.FileUploadGrant{}).
				Where("owner_id = ? AND consumed_at IS NULL AND expires_at > ?", ownerID, now).
				Select("COALESCE(SUM(expected_size), 0)").Scan(&reserved).Error; err != nil {
				return err
			}
			if dto.Size > user.StorageQuota-user.StorageUsed-reserved {
				return errStorageInsufficient
			}
		}
		return tx.Create(grant).Error
	}); err != nil {
		return nil, err
	}

	res, err := s.store.Presign(ctx, key, ct, dto.Size)
	if err != nil {
		// No usable signed URL escaped, so the reservation can be removed now.
		_ = s.repo.db.WithContext(ctx).Delete(&model.FileUploadGrant{}, "id = ? AND consumed_at IS NULL", grant.ID).Error
		return nil, err
	}
	vo := toPresignVO(res)
	return &vo, nil
}

// register records a file already uploaded directly to storage. The durable
// grant and storage HEAD response are authoritative; browser metadata is never
// trusted for size, type, ownership or quota accounting.
func (s *service) register(ctx context.Context, ownerID idgen.ID, dto registerDTO) (*FileVO, error) {
	key, ok := ownedStorageKey(ownerID, dto.Key)
	if !ok {
		return nil, errBadURL
	}

	var grant model.FileUploadGrant
	if err := s.repo.db.WithContext(ctx).First(&grant, "owner_id = ? AND storage_key = ?", ownerID, key).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, errUploadGrantInvalid
		}
		return nil, err
	}
	if grant.ConsumedAt != nil && grant.RegisteredFileID != 0 {
		if existing, err := s.repo.get(ctx, grant.RegisteredFileID); err == nil && existing != nil && existing.OwnerID == ownerID {
			vo := toFileVO(existing)
			return &vo, nil
		}
	}
	if grant.ConsumedAt != nil || time.Now().After(grant.ExpiresAt) {
		return nil, errUploadGrantInvalid
	}
	if grant.StorageScope == "" || grant.StorageScope != s.storageScope {
		return nil, errUploadGrantInvalid
	}

	meta, err := s.store.Stat(ctx, key)
	if err != nil {
		return nil, errUploadGrantInvalid
	}
	if meta.Size <= 0 {
		return nil, errEmptyFile
	}
	if meta.Size > maxFileSize {
		return nil, errFileTooLarge
	}
	if meta.Size != grant.ExpectedSize {
		return nil, errUploadMismatch
	}
	actualContentType := normalizeContentType(meta.ContentType, grant.OriginalName)
	if actualContentType != grant.ContentType {
		return nil, errUploadMismatch
	}

	var registered *model.File
	err = s.repo.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var locked model.FileUploadGrant
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&locked, "id = ? AND owner_id = ?", grant.ID, ownerID).Error; err != nil {
			return errUploadGrantInvalid
		}
		if locked.ConsumedAt != nil {
			if locked.RegisteredFileID == 0 {
				return errUploadGrantInvalid
			}
			var existing model.File
			if err := tx.First(&existing, "id = ? AND owner_id = ?", locked.RegisteredFileID, ownerID).Error; err != nil {
				return err
			}
			registered = &existing
			return nil
		}
		if time.Now().After(locked.ExpiresAt) || locked.StorageScope == "" || locked.StorageScope != s.storageScope || locked.ExpectedSize != meta.Size || locked.ContentType != actualContentType {
			return errUploadGrantInvalid
		}

		var user model.User
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&user, "id = ?", ownerID).Error; err != nil {
			return err
		}
		if user.StorageQuota > 0 && meta.Size > user.StorageQuota-user.StorageUsed {
			return errStorageInsufficient
		}

		fileRow := &model.File{
			ID:           idgen.Next(),
			OwnerID:      ownerID,
			OriginalName: locked.OriginalName,
			StorageKey:   key,
			FileUrl:      s.store.URL(key),
			FileSize:     meta.Size,
			FileType:     locked.FileType,
			Category:     locked.Category,
			MimeType:     locked.ContentType,
			StorageType:  s.store.Type(),
			CreateTime:   time.Now(),
		}
		if err := tx.Create(fileRow).Error; err != nil {
			return err
		}
		if err := tx.Model(&model.User{}).Where("id = ?", ownerID).
			UpdateColumn("storage_used", gorm.Expr("storage_used + ?", meta.Size)).Error; err != nil {
			return err
		}
		consumed := time.Now()
		if err := tx.Model(&model.FileUploadGrant{}).Where("id = ? AND consumed_at IS NULL", locked.ID).
			Updates(map[string]any{"consumed_at": consumed, "registered_file_id": fileRow.ID}).Error; err != nil {
			return err
		}
		registered = fileRow
		return nil
	})
	if err != nil {
		return nil, err
	}
	vo := toFileVO(registered)
	return &vo, nil
}

// createFileWithQuota persists file metadata and storage accounting in one
// transaction. Locking the user row makes concurrent uploads unable to race
// past the configured quota.
func (s *service) createFileWithQuota(ctx context.Context, f *model.File) error {
	return s.repo.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var user model.User
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&user, "id = ?", f.OwnerID).Error; err != nil {
			return err
		}
		if user.StorageQuota > 0 && f.FileSize > user.StorageQuota-user.StorageUsed {
			return errStorageInsufficient
		}
		if err := tx.Create(f).Error; err != nil {
			return err
		}
		return tx.Model(&model.User{}).Where("id = ?", f.OwnerID).
			UpdateColumn("storage_used", gorm.Expr("storage_used + ?", f.FileSize)).Error
	})
}

// ownedStorageKey accepts only keys minted by buildKey for this account. A
// client may know another user's OSS key, but it must never be able to register
// that object as its own and later delete it through /files/detail/:id.
func ownedStorageKey(ownerID idgen.ID, raw string) (string, bool) {
	key := strings.TrimSpace(strings.ReplaceAll(raw, "\\", "/"))
	if key == "" || strings.HasPrefix(key, "/") || path.Clean(key) != key {
		return "", false
	}
	parts := strings.Split(key, "/")
	if len(parts) != 6 || parts[0] != "uploads" || parts[4] != ownerID.String() {
		return "", false
	}
	if parts[1] != "image" && parts[1] != "video" && parts[1] != "other" {
		return "", false
	}
	if len(parts[2]) != 4 || len(parts[3]) != 2 || parts[5] == "" {
		return "", false
	}
	for _, value := range []string{parts[2], parts[3]} {
		for _, char := range value {
			if char < '0' || char > '9' {
				return "", false
			}
		}
	}
	return key, true
}

// saveFromURL fetches a remote asset server-side and stores a persistent copy.
// Used by "save to my assets" on a generated image/video URL.
func (s *service) saveFromURL(ctx context.Context, ownerID idgen.ID, dto saveFromURLDTO) (*FileVO, error) {
	if _, err := normalizeAssetCategory(dto.Category); err != nil {
		return nil, err
	}
	u := strings.TrimSpace(dto.URL)
	httpClient := s.httpcli
	if canonical, owned := trustedOwnedArchiveURL(s, u); owned {
		u = canonical
		httpClient = &http.Client{Timeout: saveFromURLTimeout, CheckRedirect: func(_ *http.Request, _ []*http.Request) error {
			return errors.New("redirect is not allowed for owned storage")
		}}
	} else if _, err := validateRemoteAssetURL(u); err != nil {
		return nil, errBadURL
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return nil, errBadURL
	}
	resp, err := httpClient.Do(req)
	if err != nil {
		return nil, errFetchFailed
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, errFetchFailed
	}

	ct := resp.Header.Get("Content-Type")
	name := dto.OriginalName
	if name == "" {
		name = nameFromURL(u)
	}
	ct = normalizeContentType(ct, name)

	return s.upload(ctx, ownerID, uploadInput{
		OriginalName: name,
		ContentType:  ct,
		FileTypeHint: dto.FileType,
		CategoryHint: dto.Category,
		Size:         resp.ContentLength,
		Reader:       resp.Body,
	})
}

// ownsDownloadURL prevents the authenticated CORS/download proxy from becoming
// a general-purpose public fetcher. Besides the caller's own media,后台用户可读
// 已登记媒体，普通用户可读已发布到社区/博客的视频。DisplayURL may have
// rewritten an old OSS base in the response, so both current and persisted base
// variants are tested.
func (s *service) ownsDownloadURL(ctx context.Context, ownerID idgen.ID, raw string) (bool, error) {
	candidates := []string{strings.TrimSpace(raw)}
	if s.store != nil {
		if canonical, ok := s.store.OwnsURL(raw); ok {
			candidates = append(candidates, canonical)
		}
		for _, pair := range s.store.PublicRewrites() {
			if pair[0] != "" && pair[1] != "" && strings.HasPrefix(raw, pair[1]) {
				candidates = append(candidates, pair[0]+strings.TrimPrefix(raw, pair[1]))
			}
		}
	}
	seen := map[string]struct{}{}
	unique := make([]string, 0, len(candidates))
	for _, candidate := range candidates {
		candidate = strings.TrimSpace(candidate)
		if candidate == "" {
			continue
		}
		if _, exists := seen[candidate]; exists {
			continue
		}
		seen[candidate] = struct{}{}
		unique = append(unique, candidate)
	}
	if len(unique) == 0 {
		return false, nil
	}
	var viewer model.User
	if err := s.repo.db.WithContext(ctx).
		Select("role", "role_id", "status").Where("id = ?", ownerID).Take(&viewer).Error; err != nil {
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			return false, err
		}
	}
	canInspectAll := false
	for _, permission := range model.AdminPermsForUser(s.repo.db.WithContext(ctx), &viewer) {
		if permission == "admin.generations" || permission == "admin.works" {
			canInspectAll = true
			break
		}
	}

	var count int64
	fileQuery := s.repo.db.WithContext(ctx).Model(&model.File{}).Where("file_url IN ?", unique)
	if !canInspectAll {
		fileQuery = fileQuery.Where("owner_id = ?", ownerID)
	}
	if err := fileQuery.Count(&count).Error; err != nil {
		return false, err
	}
	if count > 0 {
		return true, nil
	}
	taskQuery := s.repo.db.WithContext(ctx).Model(&model.AiTask{}).Where("result_url IN ?", unique)
	if !canInspectAll {
		taskQuery = taskQuery.Where("user_id = ?", ownerID)
	}
	if err := taskQuery.Count(&count).Error; err != nil {
		return false, err
	}
	if count > 0 {
		return true, nil
	}
	artifactQuery := s.repo.db.WithContext(ctx).Model(&model.SkillRunArtifact{}).
		Where("skill_run_artifact.url IN ?", unique)
	if !canInspectAll {
		artifactQuery = artifactQuery.
			Joins("JOIN skill_run ON skill_run.id = skill_run_artifact.run_id AND skill_run.deleted IS NULL").
			Where("skill_run.user_id = ?", ownerID)
	}
	if err := artifactQuery.Count(&count).Error; err != nil {
		return false, err
	}
	if count > 0 {
		return true, nil
	}

	// Multi-output providers keep secondary URLs in result_meta. SQL LIKE is
	// only a bounded prefilter; parsed JSON must contain an exact string match.
	for _, candidate := range unique {
		var tasks []model.AiTask
		metaQuery := s.repo.db.WithContext(ctx).Select("result_meta").
			Where("result_meta <> '' AND result_meta LIKE ?", "%"+candidate+"%")
		if !canInspectAll {
			metaQuery = metaQuery.Where("user_id = ?", ownerID)
		}
		if err := metaQuery.Limit(100).Find(&tasks).Error; err != nil {
			return false, err
		}
		for i := range tasks {
			if jsonContainsExactString(tasks[i].ResultMeta, candidate) {
				return true, nil
			}
		}
	}

	// Public viewers may capture a frame from media the product already exposes
	// in a published community post or blog article. LIKE only narrows candidates;
	// exact JSON/string verification below is the authorization decision.
	for _, candidate := range unique {
		var posts []model.CommunityPost
		postQuery := s.repo.db.WithContext(ctx).Select("content").
			Where("content <> '' AND content LIKE ?", "%"+candidate+"%")
		if !canInspectAll {
			postQuery = postQuery.Where("status = ?", 1)
		}
		if err := postQuery.Limit(100).Find(&posts).Error; err != nil {
			return false, err
		}
		for i := range posts {
			if jsonContainsExactString(posts[i].Content, candidate) {
				return true, nil
			}
		}

		var blogs []model.BlogPost
		blogQuery := s.repo.db.WithContext(ctx).Select("content").
			Where("content <> '' AND content LIKE ?", "%"+candidate+"%")
		if !canInspectAll {
			blogQuery = blogQuery.Where("status = ?", model.BlogStatusPublished)
		}
		if err := blogQuery.Limit(100).Find(&blogs).Error; err != nil {
			return false, err
		}
		for i := range blogs {
			if textContainsExactURL(blogs[i].Content, candidate) {
				return true, nil
			}
		}
	}
	return false, nil
}

func jsonContainsExactString(raw, target string) bool {
	var value any
	if json.Unmarshal([]byte(raw), &value) != nil {
		return false
	}
	var contains func(any) bool
	contains = func(current any) bool {
		switch typed := current.(type) {
		case string:
			return typed == target
		case []any:
			for _, item := range typed {
				if contains(item) {
					return true
				}
			}
		case map[string]any:
			for _, item := range typed {
				if contains(item) {
					return true
				}
			}
		}
		return false
	}
	return contains(value)
}

// textContainsExactURL accepts a URL embedded as a standalone Markdown/HTML
// destination, but rejects a URL that is only a prefix of another URL. This
// keeps the public-blog fallback from authorizing arbitrary paths on the same
// storage host merely because their prefix appeared in an article.
func textContainsExactURL(raw, target string) bool {
	if target == "" {
		return false
	}
	for rest, offset := raw, 0; ; {
		relative := strings.Index(rest, target)
		if relative < 0 {
			return false
		}
		start := offset + relative
		end := start + len(target)
		beforeOK := start == 0 || strings.ContainsRune("(<'\" \t\r\n", rune(raw[start-1]))
		afterOK := end == len(raw) || strings.ContainsRune(")>'\" \t\r\n", rune(raw[end]))
		if beforeOK && afterOK {
			return true
		}
		offset = start + len(target)
		if offset >= len(raw) {
			return false
		}
		rest = raw[offset:]
	}
}

// newRemoteAssetClient creates a downloader that cannot be used as an SSRF
// primitive. Validation happens again at dial time (after DNS resolution), so
// a hostname cannot pass a string check and then rebind to loopback, a private
// subnet or a cloud metadata address. Redirects receive the same validation.
func newRemoteAssetClient() *http.Client {
	dialer := &net.Dialer{Timeout: 10 * time.Second, KeepAlive: 30 * time.Second}
	transport := &http.Transport{
		Proxy:                 nil,
		ForceAttemptHTTP2:     true,
		MaxIdleConns:          20,
		IdleConnTimeout:       30 * time.Second,
		TLSHandshakeTimeout:   10 * time.Second,
		ResponseHeaderTimeout: 20 * time.Second,
		DialContext: func(ctx context.Context, network, address string) (net.Conn, error) {
			host, port, err := net.SplitHostPort(address)
			if err != nil {
				return nil, fmt.Errorf("remote asset address: %w", err)
			}
			ips, err := net.DefaultResolver.LookupNetIP(ctx, "ip", host)
			if err != nil {
				return nil, fmt.Errorf("remote asset resolve: %w", err)
			}
			if len(ips) == 0 {
				return nil, errors.New("remote asset resolve returned no addresses")
			}
			// Reject the whole hostname if any answer is unsafe. This avoids a
			// resolver alternating between a public address and a private one.
			for _, ip := range ips {
				if !isPublicRemoteIP(ip) {
					return nil, errBadURL
				}
			}
			return dialer.DialContext(ctx, network, net.JoinHostPort(ips[0].String(), port))
		},
	}
	return &http.Client{
		Timeout:   saveFromURLTimeout,
		Transport: transport,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) >= 5 {
				return errors.New("too many remote asset redirects")
			}
			_, err := validateRemoteAssetURL(req.URL.String())
			return err
		},
	}
}

func validateRemoteAssetURL(raw string) (*url.URL, error) {
	parsed, err := url.ParseRequestURI(strings.TrimSpace(raw))
	if err != nil || parsed.Hostname() == "" || parsed.User != nil {
		return nil, errBadURL
	}
	scheme := strings.ToLower(parsed.Scheme)
	if scheme != "http" && scheme != "https" {
		return nil, errBadURL
	}
	// Generated assets are served over normal web endpoints. Blocking custom
	// ports also prevents this authenticated fetcher being used as a public
	// network port scanner.
	if port := parsed.Port(); port != "" && port != "80" && port != "443" {
		return nil, errBadURL
	}
	if ip, err := netip.ParseAddr(parsed.Hostname()); err == nil && !isPublicRemoteIP(ip) {
		return nil, errBadURL
	}
	return parsed, nil
}

func isPublicRemoteIP(ip netip.Addr) bool {
	if !ip.IsValid() {
		return false
	}
	ip = ip.Unmap()
	if !ip.IsGlobalUnicast() || ip.IsPrivate() || ip.IsLoopback() || ip.IsLinkLocalUnicast() {
		return false
	}
	// Go deliberately does not classify shared carrier NAT and benchmarking
	// ranges as private, but neither is a valid generated-asset origin.
	blocked := [...]netip.Prefix{
		netip.MustParsePrefix("100.64.0.0/10"),
		netip.MustParsePrefix("198.18.0.0/15"),
	}
	for _, prefix := range blocked {
		if prefix.Contains(ip) {
			return false
		}
	}
	return true
}

func (s *service) list(ctx context.Context, ownerID idgen.ID, q fileQuery, offset, limit int) ([]FileVO, int64, error) {
	if strings.TrimSpace(q.Category) != "" {
		category, err := normalizeAssetCategory(q.Category)
		if err != nil {
			return nil, 0, err
		}
		q.Category = category
	}
	rows, total, err := s.repo.list(ctx, ownerID, q, offset, limit)
	if err != nil {
		return nil, 0, err
	}
	out := make([]FileVO, 0, len(rows))
	for i := range rows {
		out = append(out, toFileVO(&rows[i]))
	}
	return out, total, nil
}

func (s *service) get(ctx context.Context, ownerID idgen.ID, id idgen.ID) (*FileVO, error) {
	f, err := s.repo.get(ctx, id)
	if err != nil {
		return nil, err
	}
	if f == nil {
		return nil, errFileNotFound
	}
	if f.OwnerID != ownerID {
		return nil, errFileForbidden
	}
	vo := toFileVO(f)
	return &vo, nil
}

func (s *service) delete(ctx context.Context, ownerID idgen.ID, id idgen.ID) error {
	f, err := s.repo.get(ctx, id)
	if err != nil {
		return err
	}
	if f == nil {
		return errFileNotFound
	}
	if f.OwnerID != ownerID {
		return errFileForbidden
	}
	if err := s.repo.delete(ctx, id); err != nil {
		return err
	}
	if err := s.store.Delete(ctx, f.StorageKey); err != nil {
		logger.L().Warn("file: storage delete failed", zap.String("key", f.StorageKey), zap.Error(err))
	}
	if f.FileSize > 0 {
		if err := s.repo.addStorageUsed(ctx, ownerID, -f.FileSize); err != nil {
			logger.L().Warn("file: decrement storage usage failed", zap.Error(err))
		}
	}
	return nil
}

// ---- helpers ------------------------------------------------------------

// countingReader counts bytes read through it.
type countingReader struct {
	r io.Reader
	n int64
}

func (c *countingReader) Read(p []byte) (int, error) {
	n, err := c.r.Read(p)
	c.n += int64(n)
	return n, err
}

// buildKey builds a storage key: uploads/{type}/{yyyy}/{mm}/{ownerId}/{id}{ext}.
func buildKey(ownerID idgen.ID, ftype, originalName string) string {
	now := time.Now()
	ext := strings.ToLower(path.Ext(originalName))
	ext = sanitizeExt(ext, ftype)
	return fmt.Sprintf("uploads/%s/%04d/%02d/%s/%s%s",
		ftype, now.Year(), int(now.Month()), ownerID.String(), idgen.Next().String(), ext)
}

// sanitizeExt keeps a short alnum extension; falls back by file type.
func sanitizeExt(ext, ftype string) string {
	ext = strings.TrimSpace(ext)
	if ext == "." {
		ext = ""
	}
	if len(ext) > 1 && len(ext) <= 6 && isAlnumExt(ext) {
		return ext
	}
	switch ftype {
	case "image":
		return ".png"
	case "video":
		return ".mp4"
	default:
		return ""
	}
}

func isAlnumExt(ext string) bool {
	for i, r := range ext {
		if i == 0 {
			if r != '.' {
				return false
			}
			continue
		}
		if !((r >= 'a' && r <= 'z') || (r >= '0' && r <= '9')) {
			return false
		}
	}
	return true
}

// classify decides the physical FileType (image|video|other). Recognized MIME
// and filename evidence take precedence over a client hint, so a video cannot
// become a character/scene image merely by claiming fileType=image.
func classify(hint, contentType, name string) string {
	ct := strings.ToLower(contentType)
	switch {
	case strings.HasPrefix(ct, "image/"):
		return "image"
	case strings.HasPrefix(ct, "video/"):
		return "video"
	}
	switch strings.ToLower(path.Ext(name)) {
	case ".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg", ".avif":
		return "image"
	case ".mp4", ".webm", ".mov", ".mkv", ".avi", ".m4v":
		return "video"
	}
	switch strings.ToLower(strings.TrimSpace(hint)) {
	case "image":
		return "image"
	case "video":
		return "video"
	case "other":
		return "other"
	}
	return "other"
}

// typeAllowed reports whether a classified type may be stored. All three
// classifications are permitted in this phase; the hook is kept so an admin
// policy can later reject "other".
func typeAllowed(ftype string) bool {
	switch ftype {
	case "image", "video", "other":
		return true
	default:
		return false
	}
}

// activeContentRejected blocks formats that browsers can execute when served
// from the application's own /static origin. Treating these as generic files
// would otherwise turn a normal upload into persistent same-origin script.
func activeContentRejected(contentType, name string) bool {
	ct := strings.ToLower(strings.TrimSpace(contentType))
	if i := strings.IndexByte(ct, ';'); i >= 0 {
		ct = strings.TrimSpace(ct[:i])
	}
	switch ct {
	case "text/html", "application/xhtml+xml", "image/svg+xml", "application/javascript", "text/javascript", "application/xml", "text/xml":
		return true
	}
	switch strings.ToLower(path.Ext(strings.TrimSpace(name))) {
	case ".html", ".htm", ".xhtml", ".svg", ".js", ".mjs", ".xml":
		return true
	default:
		return false
	}
}

// normalizeAssetCategory keeps the asset taxonomy deliberately small. Empty is
// the backwards-compatible general category; unknown values are rejected so a
// misspelled query cannot silently return ordinary assets.
func normalizeAssetCategory(hint string) (string, error) {
	switch strings.ToLower(strings.TrimSpace(hint)) {
	case "", assetCategoryGeneral:
		return assetCategoryGeneral, nil
	case assetCategoryCharacter:
		return assetCategoryCharacter, nil
	case assetCategoryScene:
		return assetCategoryScene, nil
	default:
		return "", errInvalidCategory
	}
}

// 角色和场景当前都是图片型资产；不匹配的媒体类型直接拒绝，避免调用方
// 以为分类保存成功、实际却被静默放进普通素材。
func assetCategoryForFile(hint, ftype string) (string, error) {
	category, err := normalizeAssetCategory(hint)
	if err != nil {
		return "", err
	}
	if category != assetCategoryGeneral && ftype != "image" {
		return "", errInvalidCategory
	}
	return category, nil
}

// normalizeContentType picks a usable content type, inferring from the filename
// extension when the provided value is empty or generic.
func normalizeContentType(ct, name string) string {
	ct = strings.ToLower(strings.TrimSpace(ct))
	if ct != "" && ct != "application/octet-stream" {
		// Strip any "; charset=" suffix for storage metadata cleanliness.
		if i := strings.IndexByte(ct, ';'); i > 0 {
			return strings.TrimSpace(ct[:i])
		}
		return ct
	}
	if ext := strings.ToLower(path.Ext(name)); ext != "" {
		if guessed := mime.TypeByExtension(ext); guessed != "" {
			if i := strings.IndexByte(guessed, ';'); i > 0 {
				return strings.TrimSpace(guessed[:i])
			}
			return guessed
		}
	}
	if ct != "" {
		return ct
	}
	return "application/octet-stream"
}

// nameFromURL extracts a filename from a URL path, defaulting when absent.
func nameFromURL(u string) string {
	clean := u
	if i := strings.IndexAny(clean, "?#"); i >= 0 {
		clean = clean[:i]
	}
	base := path.Base(clean)
	if base == "" || base == "." || base == "/" {
		return ""
	}
	return base
}

// fallbackName returns name or a generated default when name is empty.
func fallbackName(name, ftype string) string {
	if strings.TrimSpace(name) != "" {
		return name
	}
	switch ftype {
	case "image":
		return "image"
	case "video":
		return "video"
	default:
		return "file"
	}
}

// pagination clamps page params and returns (offset, limit).
func pagination(pageNum, pageSize int) (int, int) {
	if pageNum <= 0 {
		pageNum = 1
	}
	if pageSize <= 0 {
		pageSize = 20
	}
	if pageSize > 200 {
		pageSize = 200
	}
	return (pageNum - 1) * pageSize, pageSize
}
