package file

import (
	"context"
	"gorm.io/gorm"
	"tidecanvas/internal/pkg/idgen"
	"tidecanvas/internal/pkg/storage"
)

// CanReadAssetURL shares the download proxy's permission decision with server
// image processing. Storage namespace ownership alone is not user permission.
func CanReadAssetURL(ctx context.Context, db *gorm.DB, store storage.StorageStrategy, userID idgen.ID, raw string) (bool, error) {
	s := &service{repo: newRepo(db), store: store}
	return s.ownsDownloadURL(ctx, userID, raw)
}
