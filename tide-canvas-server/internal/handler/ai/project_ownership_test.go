package ai

import (
	"context"
	"errors"
	"strings"
	"testing"

	"gorm.io/driver/mysql"
	"gorm.io/gorm"

	"tidecanvas/internal/pkg/idgen"
)

func TestValidateDirectProjectOwnership(t *testing.T) {
	ctx := context.Background()
	ownerID := idgen.ID(11)
	projectID := idgen.ID(401)
	calls := 0
	lookup := func(_ context.Context, gotProjectID, gotUserID idgen.ID) (bool, error) {
		calls++
		if gotProjectID != projectID || gotUserID != ownerID {
			t.Fatalf("lookup(%s, %s), want (%s, %s)", gotProjectID, gotUserID, projectID, ownerID)
		}
		return true, nil
	}
	if err := validateDirectProjectOwnership(ctx, ownerID, generateDTO{ProjectID: projectID}, lookup); err != nil {
		t.Fatal(err)
	}
	if calls != 1 {
		t.Fatalf("ownership lookup calls = %d, want 1", calls)
	}

	if err := validateDirectProjectOwnership(ctx, ownerID, generateDTO{}, lookup); err != nil {
		t.Fatal(err)
	}
	if err := validateDirectProjectOwnership(ctx, ownerID, generateDTO{
		ProjectID: projectID, SkillRunStepID: idgen.ID(99),
	}, lookup); err != nil {
		t.Fatal(err)
	}
	if calls != 1 {
		t.Fatalf("zero-project/SkillRun calls unexpectedly queried ownership: %d", calls)
	}

	foreign := func(context.Context, idgen.ID, idgen.ID) (bool, error) { return false, nil }
	if err := validateDirectProjectOwnership(ctx, ownerID, generateDTO{ProjectID: projectID}, foreign); !errors.Is(err, errProjectUnavailable) {
		t.Fatalf("foreign project error = %v, want %v", err, errProjectUnavailable)
	}
	dbErr := errors.New("database unavailable")
	failing := func(context.Context, idgen.ID, idgen.ID) (bool, error) { return false, dbErr }
	if err := validateDirectProjectOwnership(ctx, ownerID, generateDTO{ProjectID: projectID}, failing); !errors.Is(err, dbErr) {
		t.Fatalf("database error = %v, want %v", err, dbErr)
	}
}

func TestProjectOwnershipScopeUsesBothProjectAndUser(t *testing.T) {
	db, err := gorm.Open(mysql.New(mysql.Config{
		DSN: "gorm:gorm@tcp(localhost:9911)/gorm?charset=utf8mb4&parseTime=True&loc=Local", SkipInitializeWithVersion: true,
	}), &gorm.Config{DryRun: true, DisableAutomaticPing: true})
	if err != nil {
		t.Fatal(err)
	}
	sql := db.ToSQL(func(tx *gorm.DB) *gorm.DB {
		var count int64
		return projectOwnershipScope(tx, idgen.ID(401), idgen.ID(11)).Count(&count)
	})
	for _, fragment := range []string{"FROM `projects`", "id = 401", "owner_id = 11"} {
		if !strings.Contains(sql, fragment) {
			t.Fatalf("ownership SQL is missing %q: %s", fragment, sql)
		}
	}
}
