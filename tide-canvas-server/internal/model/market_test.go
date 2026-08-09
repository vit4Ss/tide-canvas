package model

import (
	"reflect"
	"testing"
)

func TestParseMarketTypeOrderAppends3DToLegacyOrder(t *testing.T) {
	got := ParseMarketTypeOrder("text,audio,image,video")
	want := []string{"text", "audio", "image", "video", "3d"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("ParseMarketTypeOrder() = %v, want %v", got, want)
	}
}

func TestParseMarketTypeOrderAccepts3D(t *testing.T) {
	got := ParseMarketTypeOrder("3d,text")
	want := []string{"3d", "text", "audio", "image", "video"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("ParseMarketTypeOrder() = %v, want %v", got, want)
	}
}
