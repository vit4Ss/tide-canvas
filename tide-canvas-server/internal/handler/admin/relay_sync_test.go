package admin

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"

	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/idgen"
)

func TestRelayModalityKeeps3DModelsOutOfImageBucket(t *testing.T) {
	for _, input := range []string{"3d", "3D", " 3D "} {
		if got := relayModality(input); got != "3d" {
			t.Fatalf("relayModality(%q) = %q, want 3d", input, got)
		}
	}
}

func TestRelayModalityUnknownStillFallsBackToImage(t *testing.T) {
	if got := relayModality("unknown"); got != "image" {
		t.Fatalf("relayModality(unknown) = %q, want image", got)
	}
}

func TestBuildStudioConfigPreservesComplete3DParamsSchema(t *testing.T) {
	var relayModel RelayModel
	if err := json.Unmarshal([]byte(`{
		"id":"hy-3d-3.1",
		"name":"Hunyuan 3D 3.1 (Tencent MaaS)",
		"modality":"3d",
		"operations":["generation"],
		"credit_cost":10,
		"capabilities":["text-to-3d","image-to-3d","multi-view","PBR","OBJ/GLB/STL/USDZ/FBX"],
		"resolution_options":[],
		"params_schema":{
			"modes":["t2_3d"]
		}
	}`), &relayModel); err != nil {
		t.Fatalf("unmarshal relay model: %v", err)
	}

	var cfg struct {
		Modes        []string       `json:"modes"`
		Operations   []string       `json:"operations"`
		Capabilities []string       `json:"capabilities"`
		ParamsSchema map[string]any `json:"paramsSchema"`
		CreditCost   float64        `json:"creditCost"`
	}
	if err := json.Unmarshal([]byte(buildStudioConfig(relayModel)), &cfg); err != nil {
		t.Fatalf("unmarshal studio config: %v", err)
	}
	if len(cfg.Modes) != 1 || cfg.Modes[0] != "t2_3d" {
		t.Fatalf("modes = %v, want relay 3d modes", cfg.Modes)
	}
	if len(cfg.Operations) != 1 || cfg.Operations[0] != "generation" {
		t.Fatalf("operations = %v, want generation", cfg.Operations)
	}
	if len(cfg.Capabilities) != 5 || cfg.Capabilities[2] != "multi-view" {
		t.Fatalf("capabilities = %v, want relay 3d capabilities", cfg.Capabilities)
	}
	if cfg.CreditCost != 10 {
		t.Fatalf("creditCost = %v, want 10", cfg.CreditCost)
	}
	paramsModes, ok := cfg.ParamsSchema["modes"].([]any)
	if !ok || len(paramsModes) != 1 || paramsModes[0] != "t2_3d" {
		t.Fatalf("paramsSchema = %v, want t2_3d modes", cfg.ParamsSchema)
	}
}

func TestMergeRelayConfigRefreshesMetadataAndPreservesAdminSettings(t *testing.T) {
	existing := `{
		"icon":"cube",
		"modes":["manual-mode"],
		"futureLocalSetting":true,
		"capabilities":["stale"],
		"operations":["stale"],
		"priceModifiers":{"stale":true},
		"paramsSchema":{"modes":["old"]},
		"creditCost":1
	}`
	fresh := `{
		"icon":"",
		"modes":["t2_3d"],
		"capabilities":["text-to-3d","PBR"],
		"operations":["generation"],
		"priceModifiers":{"enable_pbr":2},
		"paramsSchema":{"modes":["t2_3d"]},
		"creditCost":12
	}`

	var got map[string]any
	if err := json.Unmarshal([]byte(mergeRelayConfig(existing, fresh)), &got); err != nil {
		t.Fatalf("unmarshal merged config: %v", err)
	}
	if got["icon"] != "cube" || got["futureLocalSetting"] != true {
		t.Fatalf("admin settings were not preserved: %v", got)
	}
	modes, _ := got["modes"].([]any)
	if len(modes) != 1 || modes[0] != "manual-mode" {
		t.Fatalf("modes = %v, want local manual-mode", modes)
	}
	operations, _ := got["operations"].([]any)
	if len(operations) != 1 || operations[0] != "generation" {
		t.Fatalf("operations = %v, want refreshed generation", operations)
	}
	capabilities, _ := got["capabilities"].([]any)
	if len(capabilities) != 2 || capabilities[1] != "PBR" {
		t.Fatalf("capabilities = %v, want refreshed 3D capabilities", capabilities)
	}
	if got["creditCost"] != float64(1) {
		t.Fatalf("creditCost = %v, want preserved local value 1", got["creditCost"])
	}
}

func TestMergeRelayConfigDoesNotReplaceInvalidLocalConfig(t *testing.T) {
	const existing = `{not-json}`
	if got := mergeRelayConfig(existing, `{"operations":["generation"]}`); got != existing {
		t.Fatalf("invalid local config was replaced: %q", got)
	}
}

func TestFetchRelayModelsParsesReal3DCatalogShape(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/models" {
			t.Errorf("path = %q, want /v1/models", r.URL.Path)
		}
		if got := r.Header.Get("Authorization"); got != "Bearer test-key" {
			t.Errorf("authorization = %q, want bearer key", got)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`[{
			"id":"hy-3d-3.1",
			"name":"Hunyuan 3D 3.1 (Tencent MaaS)",
			"modality":"3d",
			"operations":["generation"],
			"credit_cost":10,
			"capabilities":["text-to-3d","image-to-3d","multi-view","PBR","OBJ/GLB/STL/USDZ/FBX"],
			"resolution_options":[],
			"params_schema":{"modes":["t2_3d"]},
			"price_modifiers":{}
		}]`))
	}))
	defer server.Close()

	models, err := FetchRelayModels(server.URL, "test-key")
	if err != nil {
		t.Fatalf("FetchRelayModels: %v", err)
	}
	if len(models) != 1 {
		t.Fatalf("models = %v, want one 3d model", models)
	}
	if models[0].ID != "hy-3d-3.1" || models[0].Modality != "3d" {
		t.Fatalf("model = %+v, want hy-3d-3.1 modality 3d", models[0])
	}
	if len(models[0].ParamsSchema.Modes) != 1 || models[0].ParamsSchema.Modes[0] != "t2_3d" {
		t.Fatalf("modes = %v, want t2_3d", models[0].ParamsSchema.Modes)
	}
}

func TestFetchRelayModelsAcceptsEmptyCatalog(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`[]`))
	}))
	defer server.Close()

	models, err := FetchRelayModels(server.URL, "test-key")
	if err != nil {
		t.Fatalf("empty catalog: %v", err)
	}
	if len(models) != 0 {
		t.Fatalf("models = %v, want empty", models)
	}
}

func TestFetchRelayModelsRejectsNullCatalog(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`null`))
	}))
	defer server.Close()

	if _, err := FetchRelayModels(server.URL, "test-key"); err == nil {
		t.Fatal("null catalog unexpectedly accepted")
	}
}

func TestSyncRelayModelsCreatesAndResyncs3DModelWithoutLosingAdminSettings(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:"+t.Name()+"?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Skipf("sqlite unavailable: %v", err)
	}
	if err := db.AutoMigrate(&model.MarketModel{}); err != nil {
		t.Fatalf("migrate market model: %v", err)
	}

	creditCost := "10"
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`[{` +
			`"id":"hy-3d-3.1",` +
			`"name":"Hunyuan 3D 3.1 (Tencent MaaS)",` +
			`"modality":"3d",` +
			`"operations":["generation"],` +
			`"credit_cost":` + creditCost + `,` +
			`"capabilities":["text-to-3d","image-to-3d","multi-view","PBR"],` +
			`"params_schema":{"modes":["t2_3d"]},` +
			`"price_modifiers":{"enable_pbr":2}` +
			`}]`))
	}))
	defer server.Close()

	first, err := SyncRelayModels(db, server.URL, "test-key", 0, idgen.ID(123))
	if err != nil {
		t.Fatalf("first sync: %v", err)
	}
	if first.Created != 1 || first.Updated != 0 || first.Failed != 0 {
		t.Fatalf("first result = %+v, want one creation", first)
	}

	var row model.MarketModel
	if err := db.Where("model_key = ?", "hy-3d-3.1").First(&row).Error; err != nil {
		t.Fatalf("load created 3D model: %v", err)
	}
	if row.Type != "3d" || row.Status != 0 || row.AuthorID != idgen.ID(123) {
		t.Fatalf("created row = %+v, want pending 3D model", row)
	}
	if row.Price.String() != "10" {
		t.Fatalf("created price = %s, want 10", row.Price)
	}

	adminConfig := `{
		"icon":"cube",
		"modes":["manual-mode"],
		"capabilities":["stale"],
		"operations":["stale"],
		"paramsSchema":{"modes":["old"]},
		"priceModifiers":{},
		"creditCost":1
	}`
	if err := db.Model(&model.MarketModel{}).Where("id = ?", row.ID).Update("config", adminConfig).Error; err != nil {
		t.Fatalf("save admin config: %v", err)
	}

	creditCost = "12"
	second, err := SyncRelayModels(db, server.URL, "test-key", 1, idgen.ID(999))
	if err != nil {
		t.Fatalf("second sync: %v", err)
	}
	if second.Created != 0 || second.Updated != 1 || second.Failed != 0 {
		t.Fatalf("second result = %+v, want one update", second)
	}
	var count int64
	if err := db.Model(&model.MarketModel{}).Where("model_key = ?", "hy-3d-3.1").Count(&count).Error; err != nil {
		t.Fatalf("count 3D models: %v", err)
	}
	if count != 1 {
		t.Fatalf("model count = %d, want no duplicate after re-sync", count)
	}
	if err := db.Where("id = ?", row.ID).First(&row).Error; err != nil {
		t.Fatalf("reload 3D model: %v", err)
	}
	if row.Status != 0 || row.AuthorID != idgen.ID(123) {
		t.Fatalf("re-sync changed local ownership/status: %+v", row)
	}
	if row.Price.String() != "10" {
		t.Fatalf("re-sync price = %s, want preserved 10", row.Price)
	}
	var cfg map[string]any
	if err := json.Unmarshal([]byte(row.Config), &cfg); err != nil {
		t.Fatalf("unmarshal re-synced config: %v", err)
	}
	if cfg["icon"] != "cube" {
		t.Fatalf("icon = %v, want preserved cube", cfg["icon"])
	}
	modes, _ := cfg["modes"].([]any)
	if len(modes) != 1 || modes[0] != "manual-mode" {
		t.Fatalf("modes = %v, want preserved manual mode", modes)
	}
	if cfg["creditCost"] != float64(1) {
		t.Fatalf("creditCost = %v, want preserved local value 1", cfg["creditCost"])
	}
	paramsSchema, _ := cfg["paramsSchema"].(map[string]any)
	paramsModes, _ := paramsSchema["modes"].([]any)
	if len(paramsModes) != 1 || paramsModes[0] != "t2_3d" {
		t.Fatalf("paramsSchema = %v, want refreshed t2_3d", paramsSchema)
	}
}
