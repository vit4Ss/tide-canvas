package project

import (
	"errors"
	"strings"
	"sync"
	"testing"

	"gorm.io/gorm/schema"

	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/idgen"
)

func TestCreateRequestFingerprintUsesPersistedPayload(t *testing.T) {
	a := CreateDTO{Name: "  Launch canvas  ", Description: "  initial draft  ", ClientRequestID: "request-a"}
	b := CreateDTO{Name: "Launch canvas", Description: "initial draft", ClientRequestID: "request-b"}
	ha, err := createRequestFingerprint(a)
	if err != nil {
		t.Fatal(err)
	}
	hb, err := createRequestFingerprint(b)
	if err != nil {
		t.Fatal(err)
	}
	if ha != hb {
		t.Fatalf("equivalent persisted payloads produced different hashes: %s != %s", ha, hb)
	}
	b.Description = "changed"
	hb, err = createRequestFingerprint(b)
	if err != nil {
		t.Fatal(err)
	}
	if ha == hb {
		t.Fatal("different project payloads produced the same hash")
	}
}

func TestCreateReplayReturnsOriginalAndRejectsPayloadChange(t *testing.T) {
	hash, err := createRequestFingerprint(CreateDTO{Name: "Canvas", Description: "Draft"})
	if err != nil {
		t.Fatal(err)
	}
	existing := &model.Project{
		ID: idgen.ID(101), OwnerID: idgen.ID(7), Name: "Canvas", UrlToken: "original-token", ClientRequestHash: hash,
	}
	replayed, err := replayCreate(existing, hash)
	if err != nil {
		t.Fatal(err)
	}
	if replayed.ID != existing.ID || replayed.UrlToken != existing.UrlToken {
		t.Fatalf("replay did not return the original project: %#v", replayed)
	}
	if _, err := replayCreate(existing, strings.Repeat("0", 64)); !errors.Is(err, errClientRequestConflict) {
		t.Fatalf("payload change error = %v, want %v", err, errClientRequestConflict)
	}
}

func TestNewProjectUsesNullableOwnerScopedRequestKey(t *testing.T) {
	keyed := newProjectForCreate(idgen.ID(11), CreateDTO{Name: "  Keyed  ", Description: "  Draft  "}, "request-1", "hash")
	if keyed.ClientRequestID == nil || *keyed.ClientRequestID != "request-1" || keyed.ClientRequestHash != "hash" {
		t.Fatalf("keyed project lost idempotency fields: %#v", keyed)
	}
	if keyed.Name != "Keyed" || keyed.Description != "Draft" {
		t.Fatalf("project payload was not normalized: %#v", keyed)
	}
	legacy := newProjectForCreate(idgen.ID(11), CreateDTO{Name: "Legacy"}, "", "unused")
	if legacy.ClientRequestID != nil || legacy.ClientRequestHash != "" {
		t.Fatalf("unkeyed project must keep request fields NULL/empty: %#v", legacy)
	}

	parsed, err := schema.Parse(&model.Project{}, &sync.Map{}, schema.NamingStrategy{})
	if err != nil {
		t.Fatal(err)
	}
	index, ok := parsed.ParseIndexes()["idx_project_owner_client"]
	if !ok || index.Class != "UNIQUE" || len(index.Fields) != 2 ||
		index.Fields[0].DBName != "owner_id" || index.Fields[1].DBName != "client_request_id" {
		t.Fatalf("unexpected project idempotency index: %#v", index)
	}
}

func TestCreateRejectsOverlongClientRequestIDBeforeRepositoryUse(t *testing.T) {
	svc := &service{}
	if _, err := svc.create(idgen.ID(301), CreateDTO{
		Name: "Too long", ClientRequestID: strings.Repeat("x", 97),
	}); !errors.Is(err, errClientRequestIDTooLong) {
		t.Fatalf("error = %v, want %v", err, errClientRequestIDTooLong)
	}
}
