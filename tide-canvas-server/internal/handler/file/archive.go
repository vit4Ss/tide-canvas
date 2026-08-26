package file

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"path"
	"strings"
	"time"

	"gorm.io/gorm"

	"tidecanvas/internal/app"
	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/idgen"
)

// PreparedRemoteArchive is storage prepared outside the SkillRun completion
// transaction. Prepared=false means File already existed and no object was
// written by this call.
type PreparedRemoteArchive struct {
	File     model.File
	Prepared bool
}

// PrepareTextArchive materializes a generated file artifact whose provider
// result is inline text rather than a remote URL. It follows the same two-phase
// contract as PrepareRemoteArchive so SkillRun can bind the File row atomically.
func PrepareTextArchive(ctx context.Context, d *app.Deps, ownerID, sourceArtifactID idgen.ID, content, category, originalName string) (*PreparedRemoteArchive, error) {
	if d == nil || d.DB == nil || d.Storage == nil || ownerID == 0 || sourceArtifactID == 0 {
		return nil, permanentArchive(errors.New("file archive is unavailable"))
	}
	var existing model.File
	if err := d.DB.WithContext(ctx).Where("source_artifact_id = ? AND owner_id = ?", sourceArtifactID, ownerID).First(&existing).Error; err == nil {
		return &PreparedRemoteArchive{File: existing}, nil
	} else if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}
	if content == "" {
		return nil, permanentArchive(errEmptyFile)
	}
	size := int64(len([]byte(content)))
	if size > maxFileSize {
		return nil, permanentArchive(errFileTooLarge)
	}
	assetCategory, err := assetCategoryForFile(category, "other")
	if err != nil {
		return nil, permanentArchive(err)
	}
	name := strings.TrimSpace(originalName)
	if name == "" {
		name = "skill-result.md"
	}
	archiveID := idgen.Next()
	key := fmt.Sprintf("uploads/other/skill/%s/%s/%s.md", ownerID.String(), sourceArtifactID.String(), archiveID.String())
	// Serve as plain text even though the filename is Markdown. Generated model
	// output is untrusted and must not become executable same-origin HTML.
	const contentType = "text/plain; charset=utf-8"
	storedURL, err := d.Storage.Save(ctx, key, strings.NewReader(content), contentType)
	if err != nil {
		return nil, fmt.Errorf("store archive: %w", err)
	}
	sourceID := sourceArtifactID
	file := model.File{ID: archiveID, OwnerID: ownerID, SourceArtifactID: &sourceID,
		OriginalName: name, StorageKey: key, FileUrl: storedURL, FileSize: size,
		FileType: "other", Category: assetCategory, MimeType: contentType,
		StorageType: d.Storage.Type(), CreateTime: time.Now()}
	return &PreparedRemoteArchive{File: file, Prepared: true}, nil
}

type permanentArchiveError struct{ err error }

func (e permanentArchiveError) Error() string { return e.err.Error() }
func (e permanentArchiveError) Unwrap() error { return e.err }

func permanentArchive(err error) error {
	if err == nil {
		return nil
	}
	return permanentArchiveError{err: err}
}

// IsPermanentArchiveError reports input/policy failures which cannot improve on
// a worker retry (bad URL/category/type, oversized or empty response).
func IsPermanentArchiveError(err error) bool {
	var target permanentArchiveError
	return errors.As(err, &target)
}

// PermanentArchiveError marks a caller-side configuration/input failure so the
// durable runner can stop retrying it.
func PermanentArchiveError(err error) error { return permanentArchive(err) }

// PrepareRemoteArchive persists bytes under a worker-unique storage key but
// deliberately does not create the File row. SkillRun atomically creates that
// row, binds artifact.file_id and exposes succeeded. A crash before that point
// leaves only an unreferenced object; a losing worker can delete its own key
// without racing the winner's object.
func PrepareRemoteArchive(ctx context.Context, d *app.Deps, ownerID, sourceArtifactID idgen.ID, rawURL, fileType, category, originalName string) (*PreparedRemoteArchive, error) {
	if d == nil || d.DB == nil || d.Storage == nil || ownerID == 0 || sourceArtifactID == 0 {
		return nil, permanentArchive(errors.New("file archive is unavailable"))
	}
	s := newService(d)
	var existing model.File
	if err := d.DB.WithContext(ctx).Where("source_artifact_id = ? AND owner_id = ?", sourceArtifactID, ownerID).First(&existing).Error; err == nil {
		return &PreparedRemoteArchive{File: existing}, nil
	} else if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}
	u := strings.TrimSpace(rawURL)
	httpClient := s.httpcli
	if canonical, owned := trustedOwnedArchiveURL(s, u); owned {
		// OwnsURL validates both a configured serving host and this project's
		// storage prefix. It is safe to fetch a local development host, which the
		// general SSRF client correctly rejects for arbitrary URLs.
		u = canonical
		httpClient = &http.Client{Timeout: saveFromURLTimeout, CheckRedirect: func(_ *http.Request, _ []*http.Request) error {
			return errors.New("archive redirect is not allowed for owned storage")
		}}
	} else if _, err := validateRemoteAssetURL(u); err != nil {
		return nil, permanentArchive(errBadURL)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return nil, permanentArchive(errBadURL)
	}
	resp, err := httpClient.Do(req)
	if err != nil {
		return nil, errFetchFailed
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		if resp.StatusCode >= 400 && resp.StatusCode < 500 && resp.StatusCode != http.StatusRequestTimeout && resp.StatusCode != http.StatusTooManyRequests {
			return nil, permanentArchive(errFetchFailed)
		}
		return nil, errFetchFailed
	}
	if resp.ContentLength > maxFileSize {
		return nil, permanentArchive(errFileTooLarge)
	}
	name := strings.TrimSpace(originalName)
	if name == "" {
		name = nameFromURL(u)
	}
	contentType := normalizeContentType(resp.Header.Get("Content-Type"), name)
	physicalType := classify(fileType, contentType, name)
	if !typeAllowed(physicalType) {
		return nil, permanentArchive(errFileTypeRejected)
	}
	assetCategory, err := assetCategoryForFile(category, physicalType)
	if err != nil {
		return nil, permanentArchive(err)
	}
	ext := sanitizeExt(strings.ToLower(path.Ext(name)), physicalType)
	archiveID := idgen.Next()
	key := fmt.Sprintf("uploads/%s/skill/%s/%s/%s%s", physicalType, ownerID.String(), sourceArtifactID.String(), archiveID.String(), ext)
	counter := &countingReader{r: io.LimitReader(resp.Body, maxFileSize+1)}
	storedURL, err := s.store.Save(ctx, key, counter, contentType)
	if err != nil {
		s.publishStorageFailure("save", err)
		return nil, fmt.Errorf("store archive: %w", err)
	}
	s.resolveStorageFailure("save")
	if counter.n > maxFileSize {
		_ = s.store.Delete(ctx, key)
		return nil, permanentArchive(errFileTooLarge)
	}
	if counter.n == 0 {
		_ = s.store.Delete(ctx, key)
		return nil, permanentArchive(errEmptyFile)
	}
	sourceID := sourceArtifactID
	f := &model.File{ID: archiveID, OwnerID: ownerID, SourceArtifactID: &sourceID,
		OriginalName: fallbackName(name, physicalType), StorageKey: key, FileUrl: storedURL,
		FileSize: counter.n, FileType: physicalType, Category: assetCategory,
		MimeType: contentType, StorageType: s.store.Type(), CreateTime: time.Now()}
	return &PreparedRemoteArchive{File: *f, Prepared: true}, nil
}

func trustedOwnedArchiveURL(s *service, raw string) (string, bool) {
	canonical, owned := s.store.OwnsURL(raw)
	if !owned {
		return "", false
	}
	parsed, err := url.Parse(canonical)
	if err != nil || parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" {
		return "", false
	}
	probe, err := url.Parse(s.store.URL("__archive_probe__"))
	if err != nil || parsed.Scheme != probe.Scheme || parsed.Host != probe.Host {
		return "", false
	}
	decoded, err := url.PathUnescape(parsed.EscapedPath())
	if err != nil || decoded != path.Clean(decoded) {
		return "", false
	}
	allowedPrefix := strings.TrimSuffix(path.Dir(probe.Path), "/") + "/"
	if !strings.HasPrefix(decoded, allowedPrefix) || decoded == allowedPrefix {
		return "", false
	}
	parsed.Path = decoded
	parsed.RawPath = ""
	return parsed.String(), true
}
