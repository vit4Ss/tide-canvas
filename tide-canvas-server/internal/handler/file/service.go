package file

import (
	"context"
	"errors"
	"fmt"
	"io"
	"mime"
	"net/http"
	"path"
	"strings"
	"time"

	"go.uber.org/zap"

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
	saveFromURLTimeout = 60 * time.Second
)

// Domain errors mapped to business codes by the HTTP layer.
var (
	errFileNotFound     = errors.New("file not found")
	errFileForbidden    = errors.New("not allowed to access this file")
	errFileTooLarge     = errors.New("file size exceeds the limit")
	errFileTypeRejected = errors.New("file type is not allowed")
	errEmptyFile        = errors.New("empty file")
	errBadURL           = errors.New("invalid url")
	errFetchFailed      = errors.New("failed to fetch remote file")
)

// service holds file domain business logic.
type service struct {
	repo    *repo
	store   storage.StorageStrategy
	httpcli *http.Client
}

func newService(d *app.Deps) *service {
	return &service{
		repo:    newRepo(d.DB),
		store:   d.Storage,
		httpcli: &http.Client{Timeout: saveFromURLTimeout},
	}
}

// uploadInput carries the bytes + metadata for a server-mediated upload.
type uploadInput struct {
	OriginalName string
	ContentType  string
	FileTypeHint string // optional client hint ("image"|"video"|"other")
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
	ftype := classify(in.FileTypeHint, ct, in.OriginalName)
	if !typeAllowed(ftype) {
		return nil, errFileTypeRejected
	}

	key := buildKey(ownerID, ftype, in.OriginalName)

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
		MimeType:     ct,
		StorageType:  s.store.Type(),
		CreateTime:   time.Now(),
	}
	if err := s.repo.create(ctx, f); err != nil {
		_ = s.store.Delete(ctx, key)
		return nil, err
	}
	if err := s.repo.addStorageUsed(ctx, ownerID, f.FileSize); err != nil {
		logger.L().Warn("file: update storage usage failed", zap.String("userId", ownerID.String()), zap.Error(err))
	}
	vo := toFileVO(f)
	return &vo, nil
}

// presign returns a direct-upload grant. For local storage Direct is false, so
// the frontend (uploadFileSmart) falls back to the server-mediated /upload path.
// NOTE: keep Direct=false for local — the contract relies on the fallback.
func (s *service) presign(ctx context.Context, ownerID idgen.ID, dto presignDTO) (*FilePresignVO, error) {
	ct := normalizeContentType(dto.ContentType, dto.Filename)
	ftype := classify(dto.FileType, ct, dto.Filename)
	if !typeAllowed(ftype) {
		return nil, errFileTypeRejected
	}
	key := buildKey(ownerID, ftype, dto.Filename)
	res, err := s.store.Presign(ctx, key, ct)
	if err != nil {
		return nil, err
	}
	vo := toPresignVO(res)
	return &vo, nil
}

// register records a file already uploaded directly to storage (e.g. via OSS
// presigned PUT). For local storage this path is unused (presign returns
// Direct=false), but it is implemented for forward compatibility: it verifies
// the object exists by resolving its URL and trusts the client-reported name.
func (s *service) register(ctx context.Context, ownerID idgen.ID, dto registerDTO) (*FileVO, error) {
	if strings.TrimSpace(dto.Key) == "" {
		return nil, errBadURL
	}
	ct := normalizeContentType(dto.ContentType, dto.OriginalName)
	ftype := classify(dto.FileType, ct, dto.OriginalName)
	if !typeAllowed(ftype) {
		return nil, errFileTypeRejected
	}
	url := s.store.URL(dto.Key)
	f := &model.File{
		ID:           idgen.Next(),
		OwnerID:      ownerID,
		OriginalName: fallbackName(dto.OriginalName, ftype),
		StorageKey:   dto.Key,
		FileUrl:      url,
		FileSize:     0, // unknown for direct uploads; size not reported by client
		FileType:     ftype,
		MimeType:     ct,
		StorageType:  s.store.Type(),
		CreateTime:   time.Now(),
	}
	if err := s.repo.create(ctx, f); err != nil {
		return nil, err
	}
	vo := toFileVO(f)
	return &vo, nil
}

// saveFromURL fetches a remote asset server-side and stores a persistent copy.
// Used by "save to my assets" on a generated image/video URL.
func (s *service) saveFromURL(ctx context.Context, ownerID idgen.ID, dto saveFromURLDTO) (*FileVO, error) {
	u := strings.TrimSpace(dto.URL)
	if u == "" || !(strings.HasPrefix(u, "http://") || strings.HasPrefix(u, "https://")) {
		return nil, errBadURL
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return nil, errBadURL
	}
	resp, err := s.httpcli.Do(req)
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
		Size:         resp.ContentLength,
		Reader:       resp.Body,
	})
}

func (s *service) list(ctx context.Context, ownerID idgen.ID, q fileQuery, offset, limit int) ([]FileVO, int64, error) {
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

// classify decides the FileType (image|video|other) from a client hint, the
// content type, then the filename extension.
func classify(hint, contentType, name string) string {
	switch strings.ToLower(strings.TrimSpace(hint)) {
	case "image":
		return "image"
	case "video":
		return "video"
	case "other":
		return "other"
	}
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

// normalizeContentType picks a usable content type, inferring from the filename
// extension when the provided value is empty or generic.
func normalizeContentType(ct, name string) string {
	ct = strings.TrimSpace(ct)
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
