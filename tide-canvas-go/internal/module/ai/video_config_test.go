package ai

import (
	"testing"

	"github.com/shopspring/decimal"
)

func validVideoConfigJSON() []byte {
	return []byte(`{
		"ratios":["auto","16:9"],
		"resolutions":["480P","768P"],
		"durations":[4,10,30],
		"audio":true,
		"secondPricing":{
			"480P":{"withoutAudio":1,"withAudio":2},
			"768P":{"withoutAudio":3,"withAudio":4}
		}
	}`)
}

func TestValidateVideoModelConfig(t *testing.T) {
	if err := validateVideoModelConfig(validVideoConfigJSON(), true); err != nil {
		t.Fatalf("valid config rejected: %v", err)
	}

	missingAudioPrice := []byte(`{
		"ratios":["auto"],"resolutions":["480P"],"durations":[4],"audio":true,
		"secondPricing":{"480P":{"withoutAudio":1}}
	}`)
	if err := validateVideoModelConfig(missingAudioPrice, true); err == nil {
		t.Fatal("expected missing with-audio price to fail")
	}

	noAudio := []byte(`{
		"ratios":["auto"],"resolutions":["480P"],"durations":[4],"audio":false,
		"secondPricing":{"480P":{"withoutAudio":1}}
	}`)
	if err := validateVideoModelConfig(noAudio, true); err != nil {
		t.Fatalf("audio-disabled config rejected: %v", err)
	}
}

func TestValidateVideoModelInput(t *testing.T) {
	valid := map[string]interface{}{
		"resolution":    "768p",
		"duration":      10,
		"aspectRatio":   "16:9",
		"generateAudio": true,
	}
	if err := validateVideoModelInput(validVideoConfigJSON(), valid); err != nil {
		t.Fatalf("valid input rejected: %v", err)
	}

	invalidResolution := map[string]interface{}{
		"resolution": "4k", "duration": 10, "aspectRatio": "16:9",
	}
	if err := validateVideoModelInput(validVideoConfigJSON(), invalidResolution); err == nil {
		t.Fatal("expected unsupported resolution to fail")
	}
}

func TestVideoBasePrice(t *testing.T) {
	input := map[string]interface{}{
		"resolution": "768p", "duration": 10, "aspectRatio": "auto", "audio": true,
	}
	price, err := videoBasePrice(validVideoConfigJSON(), input)
	if err != nil {
		t.Fatalf("videoBasePrice failed: %v", err)
	}
	if !price.Equal(decimal.NewFromInt(40)) {
		t.Fatalf("expected 40, got %s", price)
	}

	decimalConfig := []byte(`{
		"ratios":["auto"],"resolutions":["480P"],"durations":[5],"audio":false,
		"secondPricing":{"480P":{"withoutAudio":0.21}}
	}`)
	decimalPrice, err := videoBasePrice(decimalConfig, map[string]interface{}{
		"resolution": "480p", "duration": 5, "aspectRatio": "auto", "audio": false,
	})
	if err != nil {
		t.Fatalf("decimal videoBasePrice failed: %v", err)
	}
	if !decimalPrice.Equal(decimal.RequireFromString("1.05")) {
		t.Fatalf("expected 1.05, got %s", decimalPrice)
	}
	if got := ceilToInt(decimalPrice); got != 2 {
		t.Fatalf("expected decimal total to ceil to 2, got %d", got)
	}
}

func TestValidateVideoRouteConditions(t *testing.T) {
	valid := []byte(`{"resolutions":["768P"],"ratios":["16:9"],"durations":[30]}`)
	if err := validateVideoRouteConditions(validVideoConfigJSON(), valid); err != nil {
		t.Fatalf("valid route rejected: %v", err)
	}
	invalid := []byte(`{"durations":[20]}`)
	if err := validateVideoRouteConditions(validVideoConfigJSON(), invalid); err == nil {
		t.Fatal("expected out-of-capability route to fail")
	}
}

func TestApplyRunwareVideoAudio(t *testing.T) {
	task := map[string]interface{}{
		"providerSettings": map[string]interface{}{
			"google": map[string]interface{}{"enhancePrompt": true},
		},
	}
	applyRunwareVideoAudio(task, "google:3@3", false)
	settings := task["providerSettings"].(map[string]interface{})
	google := settings["google"].(map[string]interface{})
	if google["generateAudio"] != false || google["enhancePrompt"] != true {
		t.Fatalf("unexpected provider settings: %#v", google)
	}

	unsupported := map[string]interface{}{}
	applyRunwareVideoAudio(unsupported, "runware:190@1", true)
	if _, exists := unsupported["providerSettings"]; exists {
		t.Fatal("unknown provider must not receive unsupported providerSettings")
	}
}

func TestIsVideoGenerationHandler(t *testing.T) {
	for _, name := range []string{"text_to_video", "image_to_video", "start_end_to_video", "reference_to_video"} {
		if !isVideoGenerationHandler(name) {
			t.Fatalf("expected %s to be classified as video", name)
		}
	}
	if isVideoGenerationHandler("text_to_image") {
		t.Fatal("image handler must not be classified as video")
	}
}
