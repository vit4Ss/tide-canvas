package chat

import (
	"errors"
	"strings"
	"testing"

	"tidecanvas/internal/model"
)

func testTextAttachments(count int) []MessageAttach {
	out := make([]MessageAttach, count)
	for i := range out {
		out[i] = MessageAttach{URL: "https://cdn.example.com/reference.png", Kind: "image"}
	}
	return out
}

func TestValidateTextAttachmentsBeforeCharge(t *testing.T) {
	db := openPersistTurnTestDB(t)
	if err := db.AutoMigrate(&model.MarketModel{}); err != nil {
		t.Fatalf("migrate market model: %v", err)
	}
	for _, tt := range []struct {
		name    string
		config  string
		count   int
		wantErr string
	}{
		{name: "file input disabled", config: `{"fileUpload":false}`, count: 1, wantErr: "不支持图片或文件输入"},
		{name: "legacy file input disabled", config: `{"paramsSchema":{"file_upload":false}}`, count: 1, wantErr: "不支持图片或文件输入"},
		{name: "configured count", config: `{"fileUpload":true,"maxFileCount":10}`, count: 11, wantErr: "最多分析 10 个附件"},
	} {
		t.Run(tt.name, func(t *testing.T) {
			key := "validation-" + strings.ReplaceAll(tt.name, " ", "-")
			if err := db.Create(&model.MarketModel{
				Name: "Validation model " + tt.name, ModelKey: key, Type: "text", Status: 1, Config: tt.config,
			}).Error; err != nil {
				t.Fatalf("create model: %v", err)
			}
			svc := &service{repo: newRepo(db)}
			err := svc.validateTextAttachments(testTextAttachments(tt.count), key)
			if err == nil || !strings.Contains(err.Error(), tt.wantErr) {
				t.Fatalf("error = %v, want text containing %q", err, tt.wantErr)
			}
			var invalid invalidTextAttachmentsError
			if !errors.As(err, &invalid) {
				t.Fatalf("error type = %T, want invalidTextAttachmentsError", err)
			}
		})
	}
}

func TestValidateTextAttachmentsAllowsLegacyModelAndHardCapIsIndependent(t *testing.T) {
	db := openPersistTurnTestDB(t)
	if err := db.AutoMigrate(&model.MarketModel{}); err != nil {
		t.Fatalf("migrate market model: %v", err)
	}
	key := "validation-legacy"
	if err := db.Create(&model.MarketModel{Name: "Legacy", ModelKey: key, Type: "text", Status: 1}).Error; err != nil {
		t.Fatalf("create model: %v", err)
	}
	svc := &service{repo: newRepo(db)}
	if err := svc.validateTextAttachments(testTextAttachments(11), key); err != nil {
		t.Fatalf("legacy model rejected compatible attachment count: %v", err)
	}
	err := svc.validateTextAttachments(testTextAttachments(maxTextChatAttachments+1), key)
	if err == nil || !strings.Contains(err.Error(), "一次最多分析 12 个附件") {
		t.Fatalf("hard cap error = %v", err)
	}
}
