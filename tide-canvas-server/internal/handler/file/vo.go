package file

import (
	"time"

	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/idgen"
	"tidecanvas/internal/pkg/storage"
)

const timeLayout = "2006-01-02T15:04:05"

func fmtTime(t time.Time) string {
	if t.IsZero() {
		return ""
	}
	return t.Format(timeLayout)
}

// FileVO mirrors tide-canvas-web/src/types/file.ts FileVO. fileType is one of
// image|video|other; storageType is local|oss.
type FileVO struct {
	ID           idgen.ID `json:"id"`
	OwnerID      idgen.ID `json:"ownerId"`
	OriginalName string   `json:"originalName"`
	FileURL      string   `json:"fileUrl"`
	FileSize     int64    `json:"fileSize"`
	FileType     string   `json:"fileType"`
	MimeType     string   `json:"mimeType"`
	StorageType  string   `json:"storageType"`
	CreateTime   string   `json:"createTime"`
}

func toFileVO(f *model.File) FileVO {
	return FileVO{
		ID:           f.ID,
		OwnerID:      f.OwnerID,
		OriginalName: f.OriginalName,
		FileURL:      f.FileUrl,
		FileSize:     f.FileSize,
		FileType:     f.FileType,
		MimeType:     f.MimeType,
		StorageType:  f.StorageType,
		CreateTime:   fmtTime(f.CreateTime),
	}
}

// FilePresignVO mirrors the frontend FilePresignVO (api.ts) and the storage
// PresignResult. For local storage Direct is false, so uploadFileSmart falls
// back to a server-mediated upload.
type FilePresignVO struct {
	Direct      bool   `json:"direct"`
	UploadURL   string `json:"uploadUrl,omitempty"`
	Key         string `json:"key,omitempty"`
	FileURL     string `json:"fileUrl,omitempty"`
	ContentType string `json:"contentType,omitempty"`
}

func toPresignVO(p storage.PresignResult) FilePresignVO {
	return FilePresignVO{
		Direct:      p.Direct,
		UploadURL:   p.UploadURL,
		Key:         p.Key,
		FileURL:     p.FileURL,
		ContentType: p.ContentType,
	}
}
