package ai

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"image"
	"image/color"
	"image/draw"
	_ "image/jpeg"
	"image/png"
	"io"
	"math"
	"strings"
	"time"

	xdraw "golang.org/x/image/draw"
	_ "golang.org/x/image/webp"
	filehandler "tidecanvas/internal/handler/file"
	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/idgen"
	"tidecanvas/internal/pkg/storage"
)

const maxInpaintPixels = 20_000_000
const maxInpaintBytes = 64 << 20

// APIRouter's public mask fetcher has the same 32 MiB hard ceiling. Rejecting
// here keeps an oversized mask from creating and charging a task that the next
// service is guaranteed to refuse.
const maxInpaintMaskBytes = 32 << 20

var inpaintSlots = make(chan struct{}, 1)

// Match studio-models: admin order, then use count and row id for ties.
// Missing/disabled/maintenance models never fall back to ordinary image editors.
func (r *repo) inpaintModel(ctx context.Context) (*model.AiModel, error) {
	var rows []model.MarketModel
	if err := r.db.WithContext(ctx).Where("type = ? AND status = 1", "image").Order("sort_order ASC, use_count DESC, id ASC").Find(&rows).Error; err != nil {
		return nil, err
	}
	for _, row := range rows {
		if strings.TrimSpace(row.ModelKey) != "" && model.ModelConfigSupportsMask(row.Config) && !model.ModelConfigUnderMaintenance(row.Config) {
			m := marketToAiModel(&row)
			if modelSupportsHandler(&m, "image_to_image") {
				return &m, nil
			}
		}
	}
	return nil, nil
}

func hasInpaintMask(raw json.RawMessage) bool {
	_, exists := decodeInput(raw)["maskImage"]
	return exists
}

// The server chooses the current primary row. Client modelId is only a stale
// UI hint and must never route a mask request to a different priced model.
func (s *service) resolveInpaintModel(ctx context.Context, dto *generateDTO) (*model.AiModel, error) {
	if dto == nil || !hasInpaintMask(dto.Input) {
		return nil, nil
	}
	primary, err := s.repo.inpaintModel(ctx)
	if err != nil {
		return nil, err
	}
	if primary == nil {
		return nil, skillPlacementError{message: "管理员尚未配置可用的蒙版局部重绘模型"}
	}
	expected := inputStr(decodeInput(dto.Input), "expectedMaskModelId")
	if expected != "" && expected != primary.ID.String() {
		return nil, skillPlacementError{message: "局部重绘主模型已变更，请重新打开编辑器确认模型和积分"}
	}
	return primary, nil
}

func (s *service) validateInpaint(ctx context.Context, userID idgen.ID, dto *generateDTO, m *model.AiModel) error {
	in := decodeInput(dto.Input)
	_, hasMask := in["maskImage"]
	if !hasMask {
		if inputStr(in, "toolKey") == "inpaint" {
			return skillPlacementError{message: "请先选择局部重绘区域"}
		}
		return nil
	}
	fail := func(message string) error { return skillPlacementError{message: message} }
	if dto.Handler != "image_to_image" || m.Type != "image" || !model.ModelConfigSupportsMask(m.Config) {
		return fail("所选模型未开启蒙版局部重绘")
	}
	if batchCount(in) != 1 || len(inputImageURLs(in)) != 1 || inputStr(in, "maskImage") == "" {
		return fail("局部重绘需要一张原图和一张蒙版，且每次生成一张")
	}
	if quote, exists := in["expectedPointCost"]; exists {
		value, ok := quote.(float64)
		if !ok || math.IsNaN(value) || math.IsInf(value, 0) || value < 0 || math.Trunc(value) != value {
			return fail("局部重绘报价无效，请重新打开编辑器")
		}
		if value != float64(resolveCost(m, dto.Input)) {
			return fail("局部重绘价格已变更，请重新打开编辑器确认最新积分")
		}
	}
	// Validate bytes and dimensions before charging. Use our storage directly,
	// never decode arbitrary URL targets or trust browser supplied dimensions.
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	for _, raw := range []string{inputImageURLs(in)[0], inputStr(in, "maskImage")} {
		allowed, err := filehandler.CanReadAssetURL(ctx, s.repo.db, s.storage, userID, raw)
		if err != nil {
			return err
		}
		if !allowed {
			return fail("无权使用该原图或蒙版，请从自己的资产库重新选择")
		}
	}
	select {
	case inpaintSlots <- struct{}{}:
		defer func() { <-inpaintSlots }()
	case <-ctx.Done():
		return fail("图片检查超时，请重试")
	}
	source, orientation, err := s.readInpaintRaster(ctx, inputImageURLs(in)[0])
	if err != nil {
		return fail("局部重绘原图无法读取或过大，请使用本站已保存的图片（最多 2000 万像素）")
	}
	mask, err := s.readInpaintImage(ctx, inputStr(in, "maskImage"), "png")
	if err != nil {
		return fail("蒙版无法读取，请重新选择修改区域")
	}
	if source.Bounds().Size() != mask.Bounds().Size() {
		return fail("蒙版尺寸与原图不一致，请重新选择区域")
	}
	if !hasEditablePixels(mask) {
		return fail("请先涂抹需要修改的区域")
	}
	// Overwrite caller hints before persisting. Recovery and provider execution
	// both use this same server-observed orientation.
	in[inpaintOrientationKey] = orientation
	dto.Input, err = json.Marshal(in)
	if err != nil {
		return err
	}
	return nil
}

func (s *service) readInpaintImage(ctx context.Context, raw string, requiredFormat ...string) (image.Image, error) {
	img, _, err := s.readInpaintRaster(ctx, raw, requiredFormat...)
	return img, err
}

func (s *service) readInpaintRaster(ctx context.Context, raw string, requiredFormat ...string) (image.Image, int, error) {
	reader, ok := s.storage.(storage.OwnedURLReader)
	if !ok {
		return nil, 1, fmt.Errorf("inpaint storage reader unavailable")
	}
	body, err := reader.OpenURL(ctx, raw)
	if err != nil {
		return nil, 1, err
	}
	defer body.Close()
	maxBytes := int64(maxInpaintBytes)
	if len(requiredFormat) > 0 && requiredFormat[0] == "png" {
		maxBytes = maxInpaintMaskBytes
	}
	data, err := io.ReadAll(io.LimitReader(body, maxBytes+1))
	if err != nil {
		return nil, 1, err
	}
	if int64(len(data)) > maxBytes {
		return nil, 1, fmt.Errorf("image exceeds size limit")
	}
	cfg, format, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil {
		return nil, 1, err
	}
	if len(requiredFormat) > 0 && format != requiredFormat[0] {
		return nil, 1, fmt.Errorf("mask must be PNG")
	}
	if cfg.Width <= 0 || cfg.Height <= 0 || int64(cfg.Width)*int64(cfg.Height) > maxInpaintPixels {
		return nil, 1, fmt.Errorf("image exceeds pixel limit")
	}
	img, _, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		return nil, 1, err
	}
	orientation := inpaintOrientation(data, format)
	if len(requiredFormat) > 0 && orientation != 1 {
		return nil, 1, fmt.Errorf("mask must not contain rotated orientation metadata")
	}
	return orientInpaintImage(img, orientation), orientation, nil
}

func hasEditablePixels(mask image.Image) bool {
	b := mask.Bounds()
	for y := b.Min.Y; y < b.Max.Y; y++ {
		for x := b.Min.X; x < b.Max.X; x++ {
			_, _, _, a := mask.At(x, y).RGBA()
			if a < 65535 {
				return true
			}
		}
	}
	return false
}

// Copy the original everywhere except the mask. Transparent mask pixels mean
// edit (OpenAI mask semantics). No global resizing, colour correction or JPEG
// encoding is applied. Partial alpha blends only INSIDE the selected region.
func mergeInpaint(source, mask, edited image.Image) (image.Image, error) {
	b := source.Bounds()
	if b.Size() != mask.Bounds().Size() {
		return nil, fmt.Errorf("inpaint output dimensions differ from the source")
	}
	if b.Size() != edited.Bounds().Size() {
		e := edited.Bounds()
		if !inpaintGeometryCompatible(b.Size(), e.Size()) {
			return nil, fmt.Errorf("inpaint output aspect ratio differs from the source")
		}
		// Resize only the generated layer. The original is never resampled.
		layer := image.NewNRGBA(image.Rect(0, 0, b.Dx(), b.Dy()))
		xdraw.BiLinear.Scale(layer, layer.Bounds(), edited, e, draw.Src, nil)
		edited = layer
	}
	switch source.(type) {
	case *image.NRGBA64, *image.RGBA64, *image.Gray16, *image.Alpha16:
		return mergeInpaint16(source, mask, edited), nil
	}
	out := image.NewNRGBA(image.Rect(0, 0, b.Dx(), b.Dy()))
	draw.Draw(out, out.Bounds(), source, b.Min, draw.Src)
	for y := 0; y < b.Dy(); y++ {
		for x := 0; x < b.Dx(); x++ {
			_, _, _, alpha := mask.At(mask.Bounds().Min.X+x, mask.Bounds().Min.Y+y).RGBA()
			if alpha == 65535 {
				continue
			}
			old := out.NRGBAAt(x, y)
			fresh := color.NRGBAModel.Convert(edited.At(edited.Bounds().Min.X+x, edited.Bounds().Min.Y+y)).(color.NRGBA)
			mix := func(a, b uint8) uint8 { return uint8((uint32(a)*alpha + uint32(b)*(65535-alpha) + 32767) / 65535) }
			out.SetNRGBA(x, y, color.NRGBA{R: mix(old.R, fresh.R), G: mix(old.G, fresh.G), B: mix(old.B, fresh.B), A: mix(old.A, fresh.A)})
		}
	}
	return out, nil
}

// Preserve 16-bit source precision rather than quantizing protected pixels to
// eight bits while adding a small object. PNG preserves these values on export.
func mergeInpaint16(source, mask, edited image.Image) *image.NRGBA64 {
	b := source.Bounds()
	out := image.NewNRGBA64(image.Rect(0, 0, b.Dx(), b.Dy()))
	draw.Draw(out, out.Bounds(), source, b.Min, draw.Src)
	for y := 0; y < b.Dy(); y++ {
		for x := 0; x < b.Dx(); x++ {
			_, _, _, a := mask.At(mask.Bounds().Min.X+x, mask.Bounds().Min.Y+y).RGBA()
			if a == 65535 {
				continue
			}
			old := out.NRGBA64At(x, y)
			fresh := color.NRGBA64Model.Convert(edited.At(edited.Bounds().Min.X+x, edited.Bounds().Min.Y+y)).(color.NRGBA64)
			mix := func(left, right uint16) uint16 {
				return uint16((uint64(left)*uint64(a) + uint64(right)*uint64(65535-a) + 32767) / 65535)
			}
			out.SetNRGBA64(x, y, color.NRGBA64{R: mix(old.R, fresh.R), G: mix(old.G, fresh.G), B: mix(old.B, fresh.B), A: mix(old.A, fresh.A)})
		}
	}
	return out
}

// Image backends often align the short edge to a multiple of 16. Accept at
// most one alignment block, and at most 1.5% of the long edge. Larger framing
// changes must fail; never stretch the original to hide an incompatible result.
func inpaintGeometryCompatible(source, output image.Point) bool {
	if source.X <= 0 || source.Y <= 0 || output.X <= 0 || output.Y <= 0 {
		return false
	}
	scale := float64(max(output.X, output.Y)) / float64(max(source.X, source.Y))
	tolerance := math.Min(15.5, float64(max(output.X, output.Y))*0.015)
	return math.Abs(float64(output.X)-float64(source.X)*scale) <= tolerance &&
		math.Abs(float64(output.Y)-float64(source.Y)*scale) <= tolerance
}

func (s *service) composeInpaintResult(ctx context.Context, taskID idgen.ID, input json.RawMessage, res GenerateResult) (GenerateResult, error) {
	in := decodeInput(input)
	if _, exists := in["maskImage"]; !exists {
		return res, nil
	}
	ctx, cancel := context.WithTimeout(ctx, 2*time.Minute)
	defer cancel()
	select {
	case inpaintSlots <- struct{}{}:
		defer func() { <-inpaintSlots }()
	case <-ctx.Done():
		return res, ctx.Err()
	}
	urls := inputImageURLs(in)
	if len(urls) != 1 {
		return res, fmt.Errorf("inpaint source missing")
	}
	source, err := s.readInpaintImage(ctx, urls[0])
	if err != nil {
		return res, err
	}
	mask, err := s.readInpaintImage(ctx, inputStr(in, "maskImage"), "png")
	if err != nil {
		return res, err
	}
	edited, err := s.readInpaintImage(ctx, res.ResultURL)
	if err != nil {
		return res, err
	}
	merged, err := mergeInpaint(source, mask, edited)
	if err != nil {
		return res, err
	}
	var buf bytes.Buffer
	if err = png.Encode(&buf, merged); err != nil {
		return res, err
	}
	if buf.Len() > maxInpaintBytes {
		return res, fmt.Errorf("inpaint output exceeds size limit")
	}
	url, err := s.storage.Save(ctx, "gen/inpaint/"+taskID.String()+".png", &buf, "image/png")
	if err != nil {
		return res, err
	}
	res.ResultURL = url
	res.URLs = []string{url}
	if res.Meta == nil {
		res.Meta = map[string]any{}
	}
	res.Meta["localEdit"] = true
	res.Meta["width"] = merged.Bounds().Dx()
	res.Meta["height"] = merged.Bounds().Dy()
	return res, nil
}

func (s *service) cleanupRejectedInpaintResult(taskID idgen.ID, res GenerateResult) {
	if res.Meta == nil || res.Meta["localEdit"] != true || s.storage == nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	_ = s.storage.Delete(ctx, "gen/inpaint/"+taskID.String()+".png")
}
