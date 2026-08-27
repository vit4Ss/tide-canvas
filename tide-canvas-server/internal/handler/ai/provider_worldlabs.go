package ai

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"tidecanvas/internal/config"
	"tidecanvas/internal/pkg/relaymedia"
	"tidecanvas/internal/pkg/storage"
)

const worldLabsProviderName = "worldlabs"

var errWorldLabsNotConfigured = errors.New("World Labs Marble API is not configured")

// routedProviderClient keeps the existing relay path intact and selects the
// direct Marble integration only for models explicitly owned by World Labs.
type routedProviderClient struct {
	relay  AiProviderClient
	marble *worldLabsProviderClient
}

func newProviderClient(relayBaseURL, relayAPIKey string, worldCfg config.WorldLabsConfig, store storage.StorageStrategy) AiProviderClient {
	return &routedProviderClient{
		relay:  newRelayProviderClient(relayBaseURL, relayAPIKey, store),
		marble: newWorldLabsProviderClient(worldCfg, store),
	}
}

func (p *routedProviderClient) Type() string { return "router" }

func (p *routedProviderClient) Generate(ctx context.Context, req GenerateRequest) (GenerateResult, error) {
	if req.Model != nil && isWorldLabsModelConfig(req.Model.ModelID, req.Model.Config) {
		if p.marble == nil {
			return GenerateResult{}, errWorldLabsNotConfigured
		}
		return p.marble.Generate(ctx, req)
	}
	return p.relay.Generate(ctx, req)
}

// model.AiModel does not expose methods, so keep routing in a small concrete
// helper instead of teaching the shared model type about one supplier.
func isWorldLabsModelConfig(modelID, rawConfig string) bool {
	if strings.HasPrefix(strings.ToLower(strings.TrimSpace(modelID)), "marble-") {
		return true
	}
	var cfg struct {
		Provider string `json:"provider"`
	}
	if json.Unmarshal([]byte(rawConfig), &cfg) != nil {
		return false
	}
	provider := strings.ToLower(strings.NewReplacer("-", "", "_", "", " ", "").Replace(strings.TrimSpace(cfg.Provider)))
	return provider == "worldlabs"
}

type worldLabsProviderClient struct {
	baseURL      string
	apiKey       string
	pollInterval time.Duration
	timeout      time.Duration
	httpClient   *http.Client
	store        storage.StorageStrategy
}

func newWorldLabsProviderClient(cfg config.WorldLabsConfig, store storage.StorageStrategy) *worldLabsProviderClient {
	if strings.TrimSpace(cfg.APIKey) == "" {
		return nil
	}
	pollInterval := cfg.PollInterval
	if pollInterval <= 0 {
		pollInterval = 5 * time.Second
	}
	timeout := cfg.Timeout
	if timeout <= 0 {
		timeout = 20 * time.Minute
	}
	baseURL := strings.TrimRight(strings.TrimSpace(cfg.BaseURL), "/")
	if baseURL == "" {
		baseURL = "https://api.worldlabs.ai"
	}
	return &worldLabsProviderClient{
		baseURL:      baseURL,
		apiKey:       strings.TrimSpace(cfg.APIKey),
		pollInterval: pollInterval,
		timeout:      timeout,
		httpClient:   &http.Client{Timeout: 90 * time.Second},
		store:        store,
	}
}

func (p *worldLabsProviderClient) Type() string { return worldLabsProviderName }

func (p *worldLabsProviderClient) Generate(ctx context.Context, req GenerateRequest) (GenerateResult, error) {
	if req.Model == nil {
		return GenerateResult{}, errNoModel
	}
	if req.Handler != "generate_3d" {
		return GenerateResult{}, errUnsupportedHandler
	}
	payload, err := p.generationPayload(req.Model.ModelID, req.Input)
	if err != nil {
		return GenerateResult{}, err
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return GenerateResult{}, fmt.Errorf("World Labs: encode request: %w", err)
	}
	requestURL := p.baseURL + "/marble/v1/worlds:generate"
	out := GenerateResult{RequestURL: requestURL, RequestBody: string(body)}

	var operation worldLabsOperation
	status, responseBody, err := p.doJSON(ctx, http.MethodPost, requestURL, body, &operation)
	out.HttpStatus = status
	out.ResponseBody = string(responseBody)
	if err != nil {
		return out, err
	}
	if strings.TrimSpace(operation.OperationID) == "" {
		return out, errors.New("World Labs: generation response has no operation_id")
	}
	out.UpstreamTaskID = operation.OperationID

	pollCtx, cancel := context.WithTimeout(ctx, p.timeout)
	defer cancel()
	for !operation.Done {
		select {
		case <-pollCtx.Done():
			return out, fmt.Errorf("World Labs: world generation timed out: %w", pollCtx.Err())
		case <-time.After(p.pollInterval):
		}
		operationURL := p.baseURL + "/marble/v1/operations/" + url.PathEscape(operation.OperationID)
		status, responseBody, err = p.doJSON(pollCtx, http.MethodGet, operationURL, nil, &operation)
		out.HttpStatus = status
		out.ResponseBody = string(responseBody)
		if err != nil {
			// Polling is read-only. A transient throttle or vendor 5xx can be
			// retried safely without creating a duplicate paid world operation.
			// status=0 is a transport failure (DNS reset/connection drop), which is
			// equally safe to retry because the paid operation already has an ID.
			if status == 0 || status == http.StatusTooManyRequests || status >= http.StatusInternalServerError {
				continue
			}
			return out, err
		}
	}
	if message := operation.errorMessage(); message != "" {
		return out, fmt.Errorf("World Labs: %s", message)
	}
	if operation.Cost != nil && operation.Cost.TotalCredits > 0 {
		out.Meta = map[string]any{"supplierCredits": operation.Cost.TotalCredits}
	}
	// Asset URLs are signed and can be large. Once generation is complete, use
	// the caller lifecycle (and the archiver's own transfer limits) so a world
	// that finishes near the polling deadline still has time to become durable.
	return p.result(ctx, operation.Response, out)
}

type worldLabsGenerateRequest struct {
	DisplayName string                 `json:"display_name"`
	Model       string                 `json:"model"`
	WorldPrompt map[string]interface{} `json:"world_prompt"`
}

func (p *worldLabsProviderClient) generationPayload(modelID string, input map[string]any) (worldLabsGenerateRequest, error) {
	prompt := inputStr(input, "prompt")
	views, err := p.worldLabsMultiViewInputs(input)
	if err != nil {
		return worldLabsGenerateRequest{}, err
	}
	imageURL := inputStr(input, "imageUrl", "image_url", "sourceImage")
	if len(views) > 0 && imageURL != "" {
		return worldLabsGenerateRequest{}, errors.New("World Labs: use either one image or multi-image references, not both")
	}
	worldPrompt := map[string]interface{}{}
	switch {
	case len(views) > 0:
		worldPrompt["type"] = "multi-image"
		worldPrompt["multi_image_prompt"] = views
		if len(views) > 4 {
			// World Labs accepts at most four ordinary multi-image inputs and up
			// to eight when reconstruction mode is enabled.
			worldPrompt["reconstruct_images"] = true
		}
		if prompt != "" {
			worldPrompt["text_prompt"] = prompt
		}
	case imageURL != "":
		rewritten, err := p.worldInputURL(imageURL)
		if err != nil {
			return worldLabsGenerateRequest{}, err
		}
		imagePrompt := map[string]interface{}{"source": "uri", "uri": rewritten}
		if isPano, _ := inputBool(input, "isPano", "is_pano", "is360"); isPano {
			// Per the World API reference, is_pano is a field of the
			// ImagePrompt object itself: world_prompt.image_prompt.is_pano.
			// On the world_prompt level it is silently ignored and the
			// panorama gets reconstructed as a perspective photo.
			imagePrompt["is_pano"] = true
		}
		worldPrompt["type"] = "image"
		worldPrompt["image_prompt"] = imagePrompt
		if prompt != "" {
			worldPrompt["text_prompt"] = prompt
		}
	case prompt != "":
		worldPrompt["type"] = "text"
		worldPrompt["text_prompt"] = prompt
	default:
		return worldLabsGenerateRequest{}, errors.New("World Labs: text or image input is required")
	}

	name := strings.TrimSpace(inputStr(input, "displayName", "display_name", "title"))
	if name == "" {
		name = prompt
	}
	name = strings.TrimSpace(name)
	if name == "" {
		name = "TideCanvas World"
	}
	if len([]rune(name)) > 64 {
		name = string([]rune(name)[:64])
	}
	return worldLabsGenerateRequest{
		DisplayName: name,
		Model:       strings.TrimSpace(modelID),
		WorldPrompt: worldPrompt,
	}, nil
}

type worldLabsMultiImage struct {
	Azimuth *float64          `json:"azimuth,omitempty"`
	Content map[string]string `json:"content"`
}

func (p *worldLabsProviderClient) worldLabsMultiViewInputs(input map[string]any) ([]worldLabsMultiImage, error) {
	var raw []any
	for _, key := range []string{"multiViewImages", "multi_view_images"} {
		value, exists := input[key]
		if !exists {
			continue
		}
		values, ok := value.([]any)
		if !ok {
			return nil, errors.New("World Labs: multi-image references must be an array")
		}
		raw = values
		break
	}
	out := make([]worldLabsMultiImage, 0, len(raw))
	if len(raw) > 8 {
		return nil, errors.New("World Labs: multi-image input supports at most 8 references")
	}
	for _, item := range raw {
		row, ok := item.(map[string]any)
		if !ok {
			return nil, errors.New("World Labs: multi-image reference has an invalid shape")
		}
		rawURL := inputStr(row, "viewImageUrl", "view_image_url", "url")
		if inputStr(row, "viewImageBase64", "view_image_base64") != "" {
			return nil, errors.New("World Labs: upload multi-image references before generation; inline base64 is not supported")
		}
		if rawURL == "" {
			return nil, errors.New("World Labs: multi-image reference is missing its image URL")
		}
		rewritten, err := p.worldInputURL(rawURL)
		if err != nil {
			return nil, fmt.Errorf("World Labs: multi-image reference %d is invalid: %w", len(out)+1, err)
		}
		var azimuth *float64
		if degrees, ok := worldLabsAzimuth(inputStr(row, "viewType", "view_type")); ok {
			azimuth = &degrees
		}
		out = append(out, worldLabsMultiImage{
			Azimuth: azimuth,
			Content: map[string]string{"source": "uri", "uri": rewritten},
		})
	}
	return out, nil
}

func worldLabsAzimuth(viewType string) (float64, bool) {
	switch strings.ToLower(strings.TrimSpace(viewType)) {
	case "front":
		return 0, true
	case "left_front":
		return -45, true
	case "left":
		return -90, true
	case "right_front":
		return 45, true
	case "right":
		return 90, true
	case "back":
		return 180, true
	default:
		return 0, false
	}
}

func (p *worldLabsProviderClient) worldInputURL(raw string) (string, error) {
	if p.store != nil {
		raw = p.store.UpstreamURL(raw)
	}
	parsed, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Host == "" || parsed.User != nil {
		return "", errors.New("World Labs: reference image must use a public HTTP(S) URL")
	}
	return parsed.String(), nil
}

func (p *worldLabsProviderClient) doJSON(ctx context.Context, method, endpoint string, body []byte, target any) (int, []byte, error) {
	var reader io.Reader
	if body != nil {
		reader = bytes.NewReader(body)
	}
	req, err := http.NewRequestWithContext(ctx, method, endpoint, reader)
	if err != nil {
		return 0, nil, err
	}
	req.Header.Set("WLT-Api-Key", p.apiKey)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := p.httpClient.Do(req)
	if err != nil {
		return 0, nil, fmt.Errorf("World Labs: request failed: %w", err)
	}
	defer resp.Body.Close()
	responseBody, readErr := io.ReadAll(io.LimitReader(resp.Body, 8<<20))
	if readErr != nil {
		return resp.StatusCode, responseBody, fmt.Errorf("World Labs: read response: %w", readErr)
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return resp.StatusCode, responseBody, fmt.Errorf("World Labs: HTTP %d: %s", resp.StatusCode, compactWorldLabsError(responseBody))
	}
	if err := json.Unmarshal(responseBody, target); err != nil {
		return resp.StatusCode, responseBody, fmt.Errorf("World Labs: decode response: %w", err)
	}
	return resp.StatusCode, responseBody, nil
}

func compactWorldLabsError(body []byte) string {
	var envelope struct {
		Message string `json:"message"`
		Detail  string `json:"detail"`
		Error   struct {
			Message string `json:"message"`
		} `json:"error"`
	}
	if json.Unmarshal(body, &envelope) == nil {
		for _, value := range []string{envelope.Error.Message, envelope.Message, envelope.Detail} {
			if value = strings.TrimSpace(value); value != "" {
				return value
			}
		}
	}
	message := strings.TrimSpace(string(body))
	if len(message) > 500 {
		message = message[:500]
	}
	if message == "" {
		message = "empty response"
	}
	return message
}

type worldLabsOperation struct {
	OperationID string          `json:"operation_id"`
	Done        bool            `json:"done"`
	Error       json.RawMessage `json:"error"`
	Cost        *struct {
		TotalCredits int `json:"total_credits"`
	} `json:"cost"`
	Response worldLabsWorld `json:"response"`
}

func (o worldLabsOperation) errorMessage() string {
	trimmed := bytes.TrimSpace(o.Error)
	if len(trimmed) == 0 || bytes.Equal(trimmed, []byte("null")) || bytes.Equal(trimmed, []byte("{}")) {
		return ""
	}
	var value struct {
		Message string `json:"message"`
	}
	if json.Unmarshal(trimmed, &value) == nil && strings.TrimSpace(value.Message) != "" {
		return strings.TrimSpace(value.Message)
	}
	return compactWorldLabsError(trimmed)
}

type worldLabsWorld struct {
	ID             string `json:"world_id"`
	LegacyID       string `json:"id"`
	DisplayName    string `json:"display_name"`
	WorldMarbleURL string `json:"world_marble_url"`
	Assets         struct {
		Caption      string `json:"caption"`
		ThumbnailURL string `json:"thumbnail_url"`
		Splats       struct {
			SPZURLs struct {
				FullRes      string `json:"full_res"`
				FiveHundredK string `json:"500k"`
				OneHundredK  string `json:"100k"`
			} `json:"spz_urls"`
			Semantics struct {
				MetricScaleFactor float64 `json:"metric_scale_factor"`
				GroundPlaneOffset float64 `json:"ground_plane_offset"`
			} `json:"semantics_metadata"`
		} `json:"splats"`
		Mesh struct {
			ColliderMeshURL string `json:"collider_mesh_url"`
			HQMeshURL       string `json:"hq_mesh_url"`
			FullResMeshURL  string `json:"full_res_mesh_url"`
		} `json:"mesh"`
		Imagery struct {
			PanoURL string `json:"pano_url"`
		} `json:"imagery"`
	} `json:"assets"`
}

func (p *worldLabsProviderClient) result(ctx context.Context, world worldLabsWorld, out GenerateResult) (GenerateResult, error) {
	previewURL := world.Assets.ThumbnailURL
	rawAssets := make([]relaymedia.Asset, 0, 6)
	add := func(assetType, assetURL string) {
		if strings.TrimSpace(assetURL) != "" {
			rawAssets = append(rawAssets, relaymedia.Asset{Type: assetType, URL: assetURL, PreviewImageURL: previewURL})
		}
	}
	add("spz-500k", world.Assets.Splats.SPZURLs.FiveHundredK)
	add("spz-100k", world.Assets.Splats.SPZURLs.OneHundredK)
	add("glb", world.Assets.Mesh.ColliderMeshURL)
	add("spz-full", world.Assets.Splats.SPZURLs.FullRes)
	add("glb-hq", world.Assets.Mesh.HQMeshURL)
	add("glb-full", world.Assets.Mesh.FullResMeshURL)
	if len(rawAssets) == 0 {
		return out, errors.New("World Labs: completed world has no downloadable 3D assets")
	}

	// Marble asset URLs are signed and expire. Reuse the relay archiver's
	// bounded, SSRF-safe transfer path to make every scene durable in our OSS.
	// Start panorama preservation at the same time as the heavier 3D files so a
	// large full-resolution splat cannot make the signed panorama expire first.
	archiver := &relayProviderClient{store: p.store}
	var durableAssets []relaymedia.Asset
	panoramaURL := world.Assets.Imagery.PanoURL
	var archiveWG sync.WaitGroup
	archiveWG.Add(1)
	go func() {
		defer archiveWG.Done()
		durableAssets = archiver.rehost3DAssets(ctx, rawAssets)
	}()
	if panoramaURL != "" {
		archiveWG.Add(1)
		go func() {
			defer archiveWG.Done()
			panoramaURL = archiver.rehost(ctx, []string{panoramaURL})[0]
		}()
	}
	archiveWG.Wait()

	assets := make([]map[string]any, 0, len(durableAssets))
	for _, asset := range durableAssets {
		row := map[string]any{
			"type":              asset.Type,
			"url":               asset.URL,
			"metricScaleFactor": world.Assets.Splats.Semantics.MetricScaleFactor,
			"groundPlaneOffset": world.Assets.Splats.Semantics.GroundPlaneOffset,
		}
		if asset.PreviewImageURL != "" {
			row["previewImageUrl"] = asset.PreviewImageURL
		}
		assets = append(assets, row)
		out.URLs = append(out.URLs, asset.URL)
		if out.ResultURL == "" && strings.HasPrefix(asset.Type, "glb") {
			out.ResultURL = asset.URL
		}
	}
	if out.ResultURL == "" {
		out.ResultURL = durableAssets[0].URL
	}
	worldID := strings.TrimSpace(world.ID)
	if worldID == "" {
		// Older World API snapshots used `id`; current OpenAPI uses
		// `world_id`. Preserve rolling compatibility with both response forms.
		worldID = strings.TrimSpace(world.LegacyID)
	}
	meta := map[string]any{
		"assets":   assets,
		"worldId":  worldID,
		"worldUrl": world.WorldMarbleURL,
		"caption":  world.Assets.Caption,
		"semanticsMetadata": map[string]any{
			"metricScaleFactor": world.Assets.Splats.Semantics.MetricScaleFactor,
			"groundPlaneOffset": world.Assets.Splats.Semantics.GroundPlaneOffset,
		},
	}
	for key, value := range out.Meta {
		meta[key] = value
	}
	if panoramaURL != "" {
		meta["panoramaUrl"] = panoramaURL
	}
	out.Meta = meta
	return out, nil
}
