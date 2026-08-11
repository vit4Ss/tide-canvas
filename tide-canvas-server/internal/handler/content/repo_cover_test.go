package content

import (
	"strings"
	"testing"

	"gorm.io/driver/mysql"
	"gorm.io/gorm"
)

func TestRecentPostCoversScopeIsPublishedLightweightAndBounded(t *testing.T) {
	db, err := gorm.Open(mysql.New(mysql.Config{
		DSN:                       "gorm:gorm@tcp(localhost:9911)/gorm?charset=utf8mb4&parseTime=True&loc=Local",
		SkipInitializeWithVersion: true,
	}), &gorm.Config{DryRun: true, DisableAutomaticPing: true})
	if err != nil {
		t.Fatal(err)
	}

	sql := db.ToSQL(func(tx *gorm.DB) *gorm.DB {
		return recentPostCoversScope(tx, homeWorksLimit).Pluck("cover_url", &[]string{})
	})
	for _, fragment := range []string{
		"SELECT `cover_url`",
		"status = 1",
		"cover_url IS NOT NULL",
		"cover_url <> ''",
		"ORDER BY create_time DESC",
		"LIMIT 8",
	} {
		if !strings.Contains(sql, fragment) {
			t.Fatalf("cover-pool SQL is missing %q: %s", fragment, sql)
		}
	}
}
