package ai

import (
	"encoding/json"
	"testing"

	"tidecanvas/internal/model"
)

func TestValidateHiddenBatchCountInput(t *testing.T) {
	hiddenImage := &model.AiModel{Type: "image", Config: `{"hideBatchCount":true}`}
	visibleImage := &model.AiModel{Type: "image", Config: `{"hideBatchCount":false}`}
	video := &model.AiModel{Type: "video", Config: `{"hideBatchCount":true}`}

	if err := validateHiddenBatchCountInput(&generateDTO{Input: json.RawMessage(`{"batchCount":4}`)}, hiddenImage); err == nil {
		t.Fatal("hidden image model accepted a stale multi-image request")
	}
	if err := validateHiddenBatchCountInput(&generateDTO{Input: json.RawMessage(`{"batchCount":1}`)}, hiddenImage); err != nil {
		t.Fatalf("single image request rejected: %v", err)
	}
	if err := validateHiddenBatchCountInput(&generateDTO{Input: json.RawMessage(`{"batchCount":4}`)}, visibleImage); err != nil {
		t.Fatalf("default-visible image model changed behavior: %v", err)
	}
	if err := validateHiddenBatchCountInput(&generateDTO{Input: json.RawMessage(`{"batchCount":4}`)}, video); err != nil {
		t.Fatalf("non-image model was affected: %v", err)
	}
}
