package file

import (
	"strings"
	"testing"

	"gorm.io/driver/mysql"
	"gorm.io/gorm"

	"tidecanvas/internal/model"
)

func dryRunFileDB(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(mysql.New(mysql.Config{DSN: "gorm:gorm@tcp(localhost:9911)/gorm?charset=utf8mb4&parseTime=True&loc=Local", SkipInitializeWithVersion: true}),
		&gorm.Config{DryRun: true, DisableAutomaticPing: true})
	if err != nil {
		t.Fatal(err)
	}
	return db
}

func TestAudioAndDocumentFiltersRunBeforePagination(t *testing.T) {
	db := dryRunFileDB(t)
	for _, test := range []struct {
		name      string
		mediaKind string
		want      string
	}{
		{name: "audio", mediaKind: "audio", want: "mime_type LIKE 'audio/%'"},
		{name: "document", mediaKind: "doc", want: "COALESCE(mime_type, '') NOT LIKE 'audio/%'"},
	} {
		t.Run(test.name, func(t *testing.T) {
			q := fileQuery{MediaKind: test.mediaKind, Category: assetCategoryGeneral, OrderDirection: "asc"}
			sql := db.ToSQL(func(tx *gorm.DB) *gorm.DB {
				return applyFileListFilters(tx.Model(&model.File{}), 7, q).
					Order(fileListOrder(q)).Offset(24).Limit(24).Find(&[]model.File{})
			})
			for _, fragment := range []string{"file_type = 'other'", test.want, "ORDER BY create_time ASC", "LIMIT 24 OFFSET 24"} {
				if !strings.Contains(sql, fragment) {
					t.Fatalf("%s asset query SQL is missing %q: %s", test.name, fragment, sql)
				}
			}
		})
	}
}

func TestUnknownMediaKindReturnsNoRows(t *testing.T) {
	db := dryRunFileDB(t)
	sql := db.ToSQL(func(tx *gorm.DB) *gorm.DB {
		return applyFileListFilters(tx.Model(&model.File{}), 7, fileQuery{MediaKind: "archive"}).Find(&[]model.File{})
	})
	if !strings.Contains(sql, "1 = 0") {
		t.Fatalf("unknown media kind must not broaden the query: %s", sql)
	}
}
