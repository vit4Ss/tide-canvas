package ai

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"image"
	"image/png"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"tidecanvas/internal/config"
	"tidecanvas/internal/model"
)

type worldLabsRoundTripFunc func(*http.Request) (*http.Response, error)

func (f worldLabsRoundTripFunc) RoundTrip(request *http.Request) (*http.Response, error) {
	return f(request)
}

func TestWorldLabsProviderGeneratesAndNormalizesDurableWorldAssets(t *testing.T) {
	var polls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("WLT-Api-Key") != "world-secret" {
			t.Fatalf("missing World Labs API key header")
		}
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/marble/v1/worlds:generate":
			if r.Method != http.MethodPost {
				t.Fatalf("method = %s", r.Method)
			}
			var payload map[string]any
			if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
				t.Fatal(err)
			}
			if payload["model"] != "marble-1.0-draft" {
				t.Fatalf("model = %#v", payload["model"])
			}
			_, _ = w.Write([]byte(`{"operation_id":"op-123","done":false,"error":null,"response":null}`))
		case "/marble/v1/operations/op-123":
			if polls.Add(1) == 1 {
				_, _ = w.Write([]byte(`{"operation_id":"op-123","done":false,"error":null,"response":null}`))
				return
			}
			_, _ = w.Write([]byte(`{
				"operation_id":"op-123","done":true,"error":null,"cost":{"total_credits":230},
				"response":{"world_id":"world-1","display_name":"Forest","world_marble_url":"https://marble.worldlabs.ai/world/world-1","assets":{
					"caption":"A forest world","thumbnail_url":"https://cdn.example.com/thumb.webp",
					"splats":{"spz_urls":{"full_res":"https://cdn.example.com/full.spz","500k":"https://cdn.example.com/500k.spz","100k":"https://cdn.example.com/100k.spz"},"semantics_metadata":{"metric_scale_factor":1.25,"ground_plane_offset":0.4}},
					"mesh":{"collider_mesh_url":"https://cdn.example.com/collider.glb"},
					"imagery":{"pano_url":"https://cdn.example.com/pano.webp"}
				}}
			}`))
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	provider := newWorldLabsProviderClient(config.WorldLabsConfig{
		BaseURL: server.URL, APIKey: "world-secret", PollInterval: time.Millisecond, Timeout: time.Second,
	}, nil)
	result, err := provider.Generate(context.Background(), GenerateRequest{
		Handler: "generate_3d",
		Model:   &model.AiModel{ModelID: "marble-1.0-draft", Config: `{"provider":"worldlabs"}`},
		Input:   map[string]any{"prompt": "A forest trail"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if result.ResultURL != "https://cdn.example.com/collider.glb" {
		t.Fatalf("result URL = %q", result.ResultURL)
	}
	if result.UpstreamTaskID != "op-123" || len(result.URLs) != 4 {
		t.Fatalf("result = %#v", result)
	}
	assets, ok := result.Meta["assets"].([]map[string]any)
	if !ok || len(assets) != 4 {
		t.Fatalf("assets = %#v", result.Meta["assets"])
	}
	if assets[0]["type"] != "spz-500k" || assets[0]["metricScaleFactor"] != 1.25 {
		t.Fatalf("500k asset = %#v", assets[0])
	}
	if result.Meta["panoramaUrl"] != "https://cdn.example.com/pano.webp" {
		t.Fatalf("panorama = %#v", result.Meta["panoramaUrl"])
	}
	if result.Meta["worldId"] != "world-1" {
		t.Fatalf("world ID = %#v", result.Meta["worldId"])
	}
	if result.Meta["supplierCredits"] != 230 {
		t.Fatalf("supplier credits = %#v", result.Meta["supplierCredits"])
	}
	if strings.Contains(result.RequestBody, "world-secret") {
		t.Fatal("audit request body leaked API key")
	}
}

func TestWorldLabsMultiImagePayloadMapsViewAzimuths(t *testing.T) {
	provider := &worldLabsProviderClient{}
	payload, err := provider.generationPayload("marble-1.1", map[string]any{
		"prompt": "A studio",
		"multiViewImages": []any{
			map[string]any{"viewType": "front", "viewImageUrl": "https://cdn.example.com/front.jpg"},
			map[string]any{"viewType": "back", "viewImageUrl": "https://cdn.example.com/back.jpg"},
			map[string]any{"viewType": "top", "viewImageUrl": "https://cdn.example.com/top.jpg"},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	views, ok := payload.WorldPrompt["multi_image_prompt"].([]worldLabsMultiImage)
	if !ok || len(views) != 3 {
		t.Fatalf("views = %#v", payload.WorldPrompt["multi_image_prompt"])
	}
	if views[0].Azimuth == nil || *views[0].Azimuth != 0 || views[1].Azimuth == nil || *views[1].Azimuth != 180 {
		t.Fatalf("azimuths = %#v", views)
	}
	if views[2].Azimuth != nil {
		t.Fatalf("top view should leave azimuth unspecified: %#v", views[2])
	}
}

func TestWorldLabsPanoramaImagePayloadSetsIsPanoOnImagePrompt(t *testing.T) {
	provider := &worldLabsProviderClient{}
	payload, err := provider.generationPayload("marble-1.1", map[string]any{
		"imageUrl": "https://cdn.example.com/lobby-360.jpg",
		"isPano":   true,
	})
	if err != nil {
		t.Fatal(err)
	}
	if payload.WorldPrompt["type"] != "image" {
		t.Fatalf("world prompt = %#v", payload.WorldPrompt)
	}
	// Per the World API reference, is_pano is an ImagePrompt field; a copy on
	// the world_prompt level is ignored by the API and must not be emitted.
	if _, misplaced := payload.WorldPrompt["is_pano"]; misplaced {
		t.Fatalf("is_pano must not sit on world_prompt: %#v", payload.WorldPrompt)
	}
	imagePrompt, ok := payload.WorldPrompt["image_prompt"].(map[string]interface{})
	if !ok || imagePrompt["uri"] != "https://cdn.example.com/lobby-360.jpg" {
		t.Fatalf("image prompt = %#v", payload.WorldPrompt["image_prompt"])
	}
	if imagePrompt["is_pano"] != true {
		t.Fatalf("image prompt must carry is_pano: %#v", imagePrompt)
	}
}

func TestWorldLabsAutoPanoProbeMeasuresRealPixelRatio(t *testing.T) {
	encodePNG := func(w, h int) []byte {
		var buf bytes.Buffer
		if err := png.Encode(&buf, image.NewGray(image.Rect(0, 0, w, h))); err != nil {
			t.Fatal(err)
		}
		return buf.Bytes()
	}
	pano := encodePNG(200, 100)
	photo := encodePNG(160, 90)
	var probes atomic.Int32
	provider := &worldLabsProviderClient{
		// The real path goes through the SSRF-guarded safeFetchImage, which
		// (correctly) refuses loopback test servers — stub the download only.
		fetchImage: func(_ context.Context, srcURL string) ([]byte, string, error) {
			probes.Add(1)
			if strings.HasSuffix(srcURL, "/pano.png") {
				return pano, "image/png", nil
			}
			return photo, "image/png", nil
		},
	}
	// 2:1 equirectangular without an explicit flag → auto-marked as panorama.
	out := provider.withAutoPanoFlag(context.Background(), map[string]any{"imageUrl": "https://cdn.example.com/pano.png"})
	if out["isPano"] != true {
		t.Fatalf("2:1 image must be auto-marked as panorama: %#v", out)
	}
	// 16:9 photo stays untouched.
	out = provider.withAutoPanoFlag(context.Background(), map[string]any{"imageUrl": "https://cdn.example.com/photo.png"})
	if _, present := out["isPano"]; present {
		t.Fatalf("16:9 photo must not be marked as panorama: %#v", out)
	}
	// An explicit client decision is respected without probing.
	out = provider.withAutoPanoFlag(context.Background(), map[string]any{
		"imageUrl": "https://cdn.example.com/pano.png",
		"isPano":   false,
	})
	if out["isPano"] != false {
		t.Fatalf("explicit isPano=false must be respected: %#v", out)
	}
	if got := probes.Load(); got != 2 {
		t.Fatalf("probe count = %d, want 2 (explicit flag skips the download)", got)
	}
}

func TestWorldLabsRegularImagePayloadOmitsIsPano(t *testing.T) {
	provider := &worldLabsProviderClient{}
	payload, err := provider.generationPayload("marble-1.1", map[string]any{
		"imageUrl": "https://cdn.example.com/lobby.jpg",
	})
	if err != nil {
		t.Fatal(err)
	}
	imagePrompt, ok := payload.WorldPrompt["image_prompt"].(map[string]interface{})
	if !ok {
		t.Fatalf("image prompt = %#v", payload.WorldPrompt["image_prompt"])
	}
	if _, present := imagePrompt["is_pano"]; present {
		t.Fatalf("regular photos must not claim to be panoramas: %#v", imagePrompt)
	}
}

func TestWorldLabsPollingRetriesTransportFailureWithoutResubmitting(t *testing.T) {
	var submissions atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.URL.Path == "/marble/v1/worlds:generate" {
			submissions.Add(1)
			_, _ = w.Write([]byte(`{"operation_id":"op-retry","done":false}`))
			return
		}
		_, _ = w.Write([]byte(`{"operation_id":"op-retry","done":true,"response":{"world_id":"world-retry","assets":{"splats":{"spz_urls":{"500k":"https://cdn.example.com/world.spz"}}}}}`))
	}))
	defer server.Close()

	provider := newWorldLabsProviderClient(config.WorldLabsConfig{
		BaseURL: server.URL, APIKey: "world-secret", PollInterval: time.Millisecond, Timeout: time.Second,
	}, nil)
	baseTransport := http.DefaultTransport
	var failedPoll atomic.Bool
	provider.httpClient.Transport = worldLabsRoundTripFunc(func(request *http.Request) (*http.Response, error) {
		if request.Method == http.MethodGet && failedPoll.CompareAndSwap(false, true) {
			return nil, errors.New("temporary connection reset")
		}
		return baseTransport.RoundTrip(request)
	})

	result, err := provider.Generate(context.Background(), GenerateRequest{
		Handler: "generate_3d",
		Model:   &model.AiModel{ModelID: "marble-1.1", Config: `{"provider":"worldlabs"}`},
		Input:   map[string]any{"prompt": "room"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if !failedPoll.Load() || submissions.Load() != 1 || result.UpstreamTaskID != "op-retry" {
		t.Fatalf("failedPoll=%v submissions=%d result=%#v", failedPoll.Load(), submissions.Load(), result)
	}
}

func TestWorldLabsMultiImageEnablesReconstructionAboveFourImages(t *testing.T) {
	provider := &worldLabsProviderClient{}
	images := make([]any, 5)
	for index := range images {
		images[index] = map[string]any{"viewImageUrl": "https://cdn.example.com/view.jpg"}
	}
	payload, err := provider.generationPayload("marble-1.1", map[string]any{"multiViewImages": images})
	if err != nil {
		t.Fatal(err)
	}
	if payload.WorldPrompt["reconstruct_images"] != true {
		t.Fatalf("reconstruct_images = %#v", payload.WorldPrompt["reconstruct_images"])
	}

	images = append(images, images...)
	_, err = provider.generationPayload("marble-1.1", map[string]any{"multiViewImages": images})
	if err == nil || !strings.Contains(err.Error(), "at most 8") {
		t.Fatalf("error = %v", err)
	}
}

func TestWorldLabsDisplayNameUsesVendorLimit(t *testing.T) {
	payload, err := (&worldLabsProviderClient{}).generationPayload("marble-1.1", map[string]any{
		"prompt":      "a world",
		"displayName": strings.Repeat("界", 70),
	})
	if err != nil {
		t.Fatal(err)
	}
	if len([]rune(payload.DisplayName)) != 64 {
		t.Fatalf("display name length = %d", len([]rune(payload.DisplayName)))
	}
}

func TestWorldLabsOperationErrorAcceptsNumericCode(t *testing.T) {
	var operation worldLabsOperation
	if err := json.Unmarshal([]byte(`{"done":true,"operation_id":"op","error":{"code":400,"message":"bad world"}}`), &operation); err != nil {
		t.Fatal(err)
	}
	if message := operation.errorMessage(); message != "bad world" {
		t.Fatalf("message = %q", message)
	}
}

func TestWorldLabsResultAcceptsLegacyWorldID(t *testing.T) {
	provider := &worldLabsProviderClient{}
	world := worldLabsWorld{LegacyID: "legacy-world"}
	world.Assets.Splats.SPZURLs.FiveHundredK = "https://cdn.example.com/world.spz"
	result, err := provider.result(context.Background(), world, GenerateResult{})
	if err != nil {
		t.Fatal(err)
	}
	if result.Meta["worldId"] != "legacy-world" {
		t.Fatalf("world ID = %#v", result.Meta["worldId"])
	}
}

func TestWorldLabsRejectsNonPublicMultiImageURL(t *testing.T) {
	provider := &worldLabsProviderClient{}
	_, err := provider.generationPayload("marble-1.1", map[string]any{
		"prompt": "A studio",
		"multiViewImages": []any{
			map[string]any{"viewType": "front", "viewImageUrl": "javascript:alert(1)"},
		},
	})
	if err == nil || !strings.Contains(err.Error(), "public HTTP(S) URL") {
		t.Fatalf("error = %v", err)
	}
	_, err = provider.generationPayload("marble-1.1", map[string]any{
		"imageUrl": "https://username:password@cdn.example.com/source.jpg",
	})
	if err == nil || !strings.Contains(err.Error(), "public HTTP(S) URL") {
		t.Fatalf("credentialed URL error = %v", err)
	}
}

func TestWorldLabsRejectsConflictingOrInlineImageSources(t *testing.T) {
	provider := &worldLabsProviderClient{}
	_, err := provider.generationPayload("marble-1.1", map[string]any{
		"imageUrl": "https://cdn.example.com/single.jpg",
		"multiViewImages": []any{
			map[string]any{"viewType": "front", "viewImageUrl": "https://cdn.example.com/front.jpg"},
		},
	})
	if err == nil || !strings.Contains(err.Error(), "not both") {
		t.Fatalf("conflicting source error = %v", err)
	}
	_, err = provider.generationPayload("marble-1.1", map[string]any{
		"multiViewImages": []any{
			map[string]any{"viewType": "front", "viewImageBase64": "aGVsbG8="},
		},
	})
	if err == nil || !strings.Contains(err.Error(), "inline base64") {
		t.Fatalf("inline source error = %v", err)
	}
}

func TestWorldLabsRoutingAndMissingCredential(t *testing.T) {
	if !isWorldLabsModelConfig("marble-1.1", "") || !isWorldLabsModelConfig("custom-world", `{"provider":"World Labs"}`) {
		t.Fatal("Marble model was not routed to World Labs")
	}
	if isWorldLabsModelConfig("hy-3d-3.1", `{"provider":"relay"}`) {
		t.Fatal("relay model was routed to World Labs")
	}
	router := &routedProviderClient{relay: newStubProviderClient()}
	_, err := router.Generate(context.Background(), GenerateRequest{
		Handler: "generate_3d", Model: &model.AiModel{ModelID: "marble-1.1"}, Input: map[string]any{"prompt": "room"},
	})
	if err != errWorldLabsNotConfigured {
		t.Fatalf("error = %v", err)
	}
}
