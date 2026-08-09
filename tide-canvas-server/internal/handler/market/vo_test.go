package market

import (
	"testing"

	"tidecanvas/internal/model"
)

func TestMarketModelVOExposesCanonical3DMediaType(t *testing.T) {
	row := model.MarketModel{
		Type: "3d",
		Tags: "type:多视图生成,资产",
	}

	got := toMarketModelVO(&row, "", "")
	if got.MediaType != "3d" {
		t.Fatalf("mediaType = %q, want 3d", got.MediaType)
	}
	if got.Type != "多视图生成" {
		t.Fatalf("legacy type = %q, want 多视图生成", got.Type)
	}
}
