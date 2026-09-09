package ai

import (
	"bytes"
	"context"
	"encoding/json"
	"image"
	"image/color"
	"image/png"
	"strings"
	"testing"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"tidecanvas/internal/config"
	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/idgen"
	"tidecanvas/internal/pkg/storage"
)

func inpaintTestService(t *testing.T) *service {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, _ := db.DB()
	sqlDB.SetMaxOpenConns(1)
	t.Cleanup(func() { _ = sqlDB.Close() })
	if err = db.AutoMigrate(&model.MarketModel{}, &model.AiTask{}, &model.File{}, &model.User{}, &model.SkillRun{}, &model.SkillRunArtifact{}, &model.CommunityPost{}, &model.BlogPost{}); err != nil {
		t.Fatal(err)
	}
	store, err := storage.NewLocalStorage(config.StorageConfig{LocalDir: t.TempDir(), PublicURL: "http://assets.test"})
	if err != nil {
		t.Fatal(err)
	}
	return &service{repo: newRepo(db), storage: store, registry: newHandlerRegistry()}
}

func saveTestPNG(t *testing.T, s *service, key string, img image.Image) string {
	t.Helper()
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		t.Fatal(err)
	}
	u, err := s.storage.Save(context.Background(), key, &buf, "image/png")
	if err != nil {
		t.Fatal(err)
	}
	if err := s.repo.db.Create(&model.File{ID: idgen.Next(), OwnerID: 77, FileUrl: u}).Error; err != nil {
		t.Fatal(err)
	}
	return u
}

func TestInpaintPrimaryUsesOnlyConfiguredAvailableModels(t *testing.T) {
	s := inpaintTestService(t)
	rows := []model.MarketModel{
		{Name: "ordinary", ModelKey: "ordinary", Type: "image", Status: 1, SortOrder: -10},
		{Name: "maintenance", ModelKey: "maint", Type: "image", Status: 1, SortOrder: 0, Config: `{"supportsMask":true,"availabilityStatus":"maintenance"}`},
		{Name: "cannot-edit", ModelKey: "cannot-edit", Type: "image", Status: 1, SortOrder: 0, Config: `{"supportsMask":true,"supportedHandlers":["text_to_image"]}`},
		{Name: "primary", ModelKey: "mask-a", Type: "image", Status: 1, SortOrder: 2, Config: `{"supportsMask":true}`},
		{Name: "secondary", ModelKey: "mask-b", Type: "image", Status: 1, SortOrder: 3, Config: `{"supportsMask":true}`},
	}
	for i := range rows {
		rows[i].ID = idgen.ID(900 + i)
		if err := s.repo.db.Create(&rows[i]).Error; err != nil {
			t.Fatal(err)
		}
	}
	m, err := s.repo.inpaintModel(context.Background())
	if err != nil || m == nil || m.ModelID != "mask-a" {
		t.Fatalf("primary=%+v err=%v", m, err)
	}
	// The public studio catalog breaks equal admin order by usage before id.
	if err := s.repo.db.Model(&model.MarketModel{}).Where("model_key = ?", "mask-b").Updates(map[string]any{"sort_order": 2, "use_count": 99}).Error; err != nil {
		t.Fatal(err)
	}
	m, err = s.repo.inpaintModel(context.Background())
	if err != nil || m == nil || m.ModelID != "mask-b" {
		t.Fatalf("catalog tie-break mismatch: %+v %v", m, err)
	}
	if err := s.repo.db.Model(&model.MarketModel{}).Where("model_key = ?", "mask-b").Update("sort_order", 3).Error; err != nil {
		t.Fatal(err)
	}
	if err := s.repo.db.Model(&model.MarketModel{}).Where("model_key = ?", "mask-a").Update("status", 2).Error; err != nil {
		t.Fatal(err)
	}
	m, err = s.repo.inpaintModel(context.Background())
	if err != nil || m == nil || m.ModelID != "mask-b" {
		t.Fatalf("fallback=%+v err=%v", m, err)
	}
	if err := s.repo.db.Model(&model.MarketModel{}).Where("model_key = ?", "mask-b").Update("config", `{"supportsMask":false}`).Error; err != nil {
		t.Fatal(err)
	}
	m, err = s.repo.inpaintModel(context.Background())
	if err != nil || m != nil {
		t.Fatalf("must not fall back to ordinary: %+v %v", m, err)
	}
}

func TestInpaintMaskValidationAndProtectedPixels(t *testing.T) {
	s := inpaintTestService(t)
	ctx := context.Background()
	row := model.MarketModel{Name: "mask", ModelKey: "mask", Type: "image", Status: 1, Config: `{"supportsMask":true}`}
	row.ID = 901
	if err := s.repo.db.Create(&row).Error; err != nil {
		t.Fatal(err)
	}
	m := marketToAiModel(&row)
	source := image.NewNRGBA(image.Rect(0, 0, 4, 3))
	edited := image.NewNRGBA(source.Bounds())
	mask := image.NewNRGBA(source.Bounds())
	for y := 0; y < 3; y++ {
		for x := 0; x < 4; x++ {
			source.SetNRGBA(x, y, color.NRGBA{uint8(x * 42), uint8(y * 53), 111, 255})
			edited.SetNRGBA(x, y, color.NRGBA{255, 0, 0, 255})
			mask.SetNRGBA(x, y, color.NRGBA{0, 0, 0, 255})
		}
	}
	mask.SetNRGBA(1, 1, color.NRGBA{})
	mask.SetNRGBA(2, 1, color.NRGBA{0, 0, 0, 128})
	src := saveTestPNG(t, s, "source.png", source)
	msk := saveTestPNG(t, s, "mask.png", mask)
	output := saveTestPNG(t, s, "edited.png", edited)
	in, _ := json.Marshal(map[string]any{"sourceImage": src, "imageList": []string{src}, "maskImage": msk, "prompt": "add axe"})
	dto := generateDTO{Handler: "image_to_image", ModelID: "mask", Input: in}
	if err := s.validateInpaint(ctx, 77, &dto, &m); err != nil {
		t.Fatal(err)
	}
	if err := s.validateInpaint(ctx, 88, &dto, &m); err == nil {
		t.Fatal("another user's private image/mask was accepted")
	}
	res, err := s.composeInpaintResult(ctx, 99, in, GenerateResult{ResultURL: output, URLs: []string{output}, Meta: map[string]any{"provider": "kept"}})
	if err != nil {
		t.Fatal(err)
	}
	if res.Meta["provider"] != "kept" || res.Meta["localEdit"] != true {
		t.Fatalf("result metadata lost: %#v", res.Meta)
	}
	final, err := s.readInpaintImage(ctx, res.ResultURL)
	if err != nil {
		t.Fatal(err)
	}
	for y := 0; y < 3; y++ {
		for x := 0; x < 4; x++ {
			if y == 1 && (x == 1 || x == 2) {
				continue
			}
			if color.NRGBAModel.Convert(final.At(x, y)) != color.NRGBAModel.Convert(source.At(x, y)) {
				t.Fatalf("protected pixel changed: %d,%d %v != %v", x, y, final.At(x, y), source.At(x, y))
			}
		}
	}
	if color.NRGBAModel.Convert(final.At(1, 1)) != edited.At(1, 1) {
		t.Fatal("selection not applied")
	}
	if color.NRGBAModel.Convert(final.At(2, 1)) == source.At(2, 1) || color.NRGBAModel.Convert(final.At(2, 1)) == edited.At(2, 1) {
		t.Fatal("soft edge not blended")
	}
	// A resume uses the same input/result and produces the same durable URL/pixels.
	res2, err := s.composeInpaintResult(ctx, 99, in, GenerateResult{ResultURL: output})
	if err != nil || res2.ResultURL != res.ResultURL {
		t.Fatalf("recovery: %+v %v", res2, err)
	}
	for _, bad := range []string{
		`{"maskImage":"https://foreign.test/mask.png","sourceImage":"` + src + `"}`,
		`{"maskImage":"` + src + `","sourceImage":"` + src + `"}`,
		`{"maskImage":"` + msk + `","sourceImage":"` + src + `","batchCount":2}`,
		`{"maskImage":""}`, `{"toolKey":"inpaint"}`,
	} {
		dto.Input = json.RawMessage(bad)
		if err := s.validateInpaint(ctx, 77, &dto, &m); err == nil {
			t.Fatalf("accepted bad mask: %s", bad)
		}
	}
}

func TestInpaintAllowsBackendPixelAlignmentButNotReframing(t *testing.T) {
	for _, tc := range []struct {
		src, output image.Point
		allowed     bool
	}{
		{image.Pt(3000, 2000), image.Pt(1024, 672), true},
		{image.Pt(2000, 3000), image.Pt(672, 1024), true},
		{image.Pt(3840, 2160), image.Pt(1024, 576), true},
		{image.Pt(3840, 2160), image.Pt(1024, 1024), false},
		{image.Pt(8, 6), image.Pt(4, 4), false},
	} {
		if inpaintGeometryCompatible(tc.src, tc.output) != tc.allowed {
			t.Errorf("%v -> %v", tc.src, tc.output)
		}
	}
}

func TestInpaintRejectsUnconfiguredModelBeforeTaskCreation(t *testing.T) {
	s := inpaintTestService(t)
	m := model.MarketModel{Name: "ordinary", ModelKey: "ordinary", Type: "image", Status: 1}
	m.ID = 990
	if err := s.repo.db.Create(&m).Error; err != nil {
		t.Fatal(err)
	}
	_, err := s.generate(context.Background(), 77, generateDTO{Handler: "image_to_image", ModelID: "ordinary", Input: json.RawMessage(`{"prompt":"axe","sourceImage":"http://assets.test/source.png","maskImage":"http://assets.test/mask.png"}`)})
	if err == nil {
		t.Fatal("unconfigured model accepted")
	}
	var count int64
	s.repo.db.Model(&model.AiTask{}).Count(&count)
	if count != 0 {
		t.Fatal("invalid masked request created a task")
	}
}

func TestInpaintRejectsStaleOrInvalidQuoteBeforeTaskCreation(t *testing.T) {
	s := inpaintTestService(t)
	row := model.MarketModel{Name: "mask", ModelKey: "mask", Type: "image", Status: 1, Config: `{"supportsMask":true,"creditCost":7}`}
	row.ID = 940
	if err := s.repo.db.Create(&row).Error; err != nil {
		t.Fatal(err)
	}
	for _, quote := range []any{0, 6, 7.5, "7", -1} {
		input, _ := json.Marshal(map[string]any{"prompt": "axe", "sourceImage": "http://assets.test/source.png", "maskImage": "http://assets.test/mask.png", "expectedPointCost": quote})
		_, err := s.generate(context.Background(), 77, generateDTO{Handler: "image_to_image", ModelID: "mask", Input: input})
		if err == nil || (!strings.Contains(err.Error(), "价格已变更") && !strings.Contains(err.Error(), "报价无效")) {
			t.Fatalf("quote=%v err=%v", quote, err)
		}
	}
	var count int64
	s.repo.db.Model(&model.AiTask{}).Count(&count)
	if count != 0 {
		t.Fatal("stale pricing started tasks")
	}
}

func TestInpaintOnlyResizesGeneratedLayer(t *testing.T) {
	source := image.NewNRGBA(image.Rect(0, 0, 8, 6))
	mask := image.NewNRGBA(source.Bounds())
	edited := image.NewNRGBA(image.Rect(0, 0, 4, 3))
	for y := 0; y < 6; y++ {
		for x := 0; x < 8; x++ {
			source.SetNRGBA(x, y, color.NRGBA{uint8(x * 7), uint8(y * 11), 17, 255})
			mask.SetNRGBA(x, y, color.NRGBA{0, 0, 0, 255})
		}
	}
	mask.SetNRGBA(2, 2, color.NRGBA{})
	for y := 0; y < 3; y++ {
		for x := 0; x < 4; x++ {
			edited.SetNRGBA(x, y, color.NRGBA{255, 0, 0, 255})
		}
	}
	result, err := mergeInpaint(source, mask, edited)
	if err != nil {
		t.Fatal(err)
	}
	for y := 0; y < 6; y++ {
		for x := 0; x < 8; x++ {
			if x == 2 && y == 2 {
				continue
			}
			if color.NRGBAModel.Convert(result.At(x, y)) != source.NRGBAAt(x, y) {
				t.Fatalf("source resampled at %d,%d", x, y)
			}
		}
	}
	if color.NRGBAModel.Convert(result.At(2, 2)).(color.NRGBA).R != 255 {
		t.Fatal("generated layer not scaled")
	}
	if _, err := mergeInpaint(source, mask, image.NewNRGBA(image.Rect(0, 0, 4, 4))); err == nil {
		t.Fatal("different framing was accepted")
	}
}

func TestInpaintPreservesSixteenBitProtectedPixels(t *testing.T) {
	source := image.NewNRGBA64(image.Rect(0, 0, 2, 1))
	source.SetNRGBA64(0, 0, color.NRGBA64{R: 0x1234, G: 0x5678, B: 0x9abc, A: 65535})
	mask := image.NewNRGBA(source.Bounds())
	mask.SetNRGBA(0, 0, color.NRGBA{A: 255})
	edited := image.NewNRGBA(source.Bounds())
	edited.SetNRGBA(1, 0, color.NRGBA{R: 255, A: 255})
	result, err := mergeInpaint(source, mask, edited)
	if err != nil {
		t.Fatal(err)
	}
	var buf bytes.Buffer
	if err = png.Encode(&buf, result); err != nil {
		t.Fatal(err)
	}
	decoded, err := png.Decode(&buf)
	if err != nil {
		t.Fatal(err)
	}
	if color.NRGBA64Model.Convert(decoded.At(0, 0)) != source.NRGBA64At(0, 0) {
		t.Fatalf("protected 16-bit pixel lost precision: %v", decoded.At(0, 0))
	}
}

func TestServerSelectsCurrentPrimaryAndRejectsStaleUIHint(t *testing.T) {
	s := inpaintTestService(t)
	primary := model.MarketModel{Name: "primary", ModelKey: "mask-key", Type: "image", Status: 1, Config: `{"supportsMask":true}`}
	primary.ID = 1201
	other := model.MarketModel{Name: "other", ModelKey: "other", Type: "image", Status: 1}
	other.ID = 1202
	if err := s.repo.db.Create(&primary).Error; err != nil {
		t.Fatal(err)
	}
	if err := s.repo.db.Create(&other).Error; err != nil {
		t.Fatal(err)
	}
	for _, modelID := range []string{"other", "1202", "anything"} {
		dto := generateDTO{ModelID: modelID, Input: json.RawMessage(`{"maskImage":"https://assets.test/mask.png"}`)}
		got, err := s.resolveInpaintModel(context.Background(), &dto)
		if err != nil || got == nil || got.ID != primary.ID {
			t.Fatalf("modelId=%s got=%+v err=%v", modelID, got, err)
		}
	}
	for _, expected := range []string{"1202", "stale"} {
		dto := generateDTO{Input: json.RawMessage(`{"maskImage":"https://assets.test/mask.png","expectedMaskModelId":"` + expected + `"}`)}
		if _, err := s.resolveInpaintModel(context.Background(), &dto); err == nil {
			t.Fatalf("stale id %s accepted", expected)
		}
	}
}
