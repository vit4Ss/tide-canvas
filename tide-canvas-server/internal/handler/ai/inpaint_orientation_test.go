package ai

import (
	"bytes"
	"context"
	"encoding/binary"
	"encoding/json"
	"image"
	"image/color"
	"image/jpeg"
	"math/rand"
	"testing"
	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/idgen"
	"tidecanvas/internal/pkg/storage"
)

func testExif(orientation uint16, order binary.ByteOrder) []byte {
	data := make([]byte, 26)
	copy(data, "II")
	if order == binary.BigEndian {
		copy(data, "MM")
	}
	order.PutUint16(data[2:4], 42)
	order.PutUint32(data[4:8], 8)
	order.PutUint16(data[8:10], 1)
	order.PutUint16(data[10:12], 0x112)
	order.PutUint16(data[12:14], 3)
	order.PutUint32(data[14:18], 1)
	order.PutUint16(data[18:20], orientation)
	return data
}

func TestInpaintOrientationsPreserveEveryPixel(t *testing.T) {
	src := image.NewNRGBA(image.Rect(0, 0, 3, 2))
	for y := 0; y < 2; y++ {
		for x := 0; x < 3; x++ {
			src.SetNRGBA(x, y, color.NRGBA{R: uint8(y*3 + x), A: 255})
		}
	}
	wants := [][]uint8{{0, 1, 2, 3, 4, 5}, {2, 1, 0, 5, 4, 3}, {5, 4, 3, 2, 1, 0}, {3, 4, 5, 0, 1, 2}, {0, 3, 1, 4, 2, 5}, {3, 0, 4, 1, 5, 2}, {5, 2, 4, 1, 3, 0}, {2, 5, 1, 4, 0, 3}}
	for orientation := 1; orientation <= 8; orientation++ {
		for _, order := range []binary.ByteOrder{binary.LittleEndian, binary.BigEndian} {
			if exifOrientation(testExif(uint16(orientation), order)) != orientation {
				t.Fatalf("orientation %d not parsed", orientation)
			}
		}
		out := orientInpaintImage(src, orientation)
		expectedSize := image.Pt(3, 2)
		if orientation >= 5 {
			expectedSize = image.Pt(2, 3)
		}
		if out.Bounds().Size() != expectedSize {
			t.Fatalf("orientation %d size %v", orientation, out.Bounds())
		}
		i := 0
		for y := 0; y < out.Bounds().Dy(); y++ {
			for x := 0; x < out.Bounds().Dx(); x++ {
				if color.NRGBAModel.Convert(out.At(x, y)).(color.NRGBA).R != wants[orientation-1][i] {
					t.Fatalf("orientation %d pixel %d", orientation, i)
				}
				i++
			}
		}
	}
}

func TestRotatedJPEGUsesSameCoordinatesForMaskUpstreamAndComposite(t *testing.T) {
	s := inpaintTestService(t)
	ctx := context.Background()
	row := model.MarketModel{Name: "mask", ModelKey: "mask", Type: "image", Status: 1, Config: `{"supportsMask":true}`}
	row.ID = 1701
	if err := s.repo.db.Create(&row).Error; err != nil {
		t.Fatal(err)
	}
	m := marketToAiModel(&row)
	img := image.NewNRGBA(image.Rect(0, 0, 3, 2))
	for y := 0; y < 2; y++ {
		for x := 0; x < 3; x++ {
			img.SetNRGBA(x, y, color.NRGBA{R: uint8(30 + x*60), G: uint8(y * 200), A: 255})
		}
	}
	var jpg bytes.Buffer
	if err := jpeg.Encode(&jpg, img, &jpeg.Options{Quality: 100}); err != nil {
		t.Fatal(err)
	}
	decoded, err := jpeg.Decode(bytes.NewReader(jpg.Bytes()))
	if err != nil {
		t.Fatal(err)
	}
	exif := append([]byte("Exif\x00\x00"), testExif(6, binary.LittleEndian)...)
	data := append([]byte{}, jpg.Bytes()[:2]...)
	data = append(data, 0xff, 0xe1, byte((len(exif)+2)>>8), byte(len(exif)+2))
	data = append(data, exif...)
	data = append(data, jpg.Bytes()[2:]...)
	src, err := s.storage.Save(ctx, "rotated.jpg", bytes.NewReader(data), "image/jpeg")
	if err != nil {
		t.Fatal(err)
	}
	if err = s.repo.db.Create(&model.File{ID: idgen.Next(), OwnerID: 77, FileUrl: src}).Error; err != nil {
		t.Fatal(err)
	}
	mask := image.NewNRGBA(image.Rect(0, 0, 2, 3))
	for y := 0; y < 3; y++ {
		for x := 0; x < 2; x++ {
			mask.SetNRGBA(x, y, color.NRGBA{A: 255})
		}
	}
	mask.SetNRGBA(0, 0, color.NRGBA{})
	maskURL := saveTestPNG(t, s, "mask-rotated.png", mask)
	raw, _ := json.Marshal(map[string]any{"sourceImage": src, "maskImage": maskURL, "prompt": "axe", inpaintOrientationKey: 1})
	dto := generateDTO{Handler: "image_to_image", ModelID: "mask", Input: raw}
	if err = s.validateInpaint(ctx, 77, &dto, &m); err != nil {
		t.Fatal(err)
	}
	in := decodeInput(dto.Input)
	if inputInt(in, inpaintOrientationKey) != 6 {
		t.Fatal("caller orientation hint was trusted")
	}
	upstream, err := s.prepareInpaintProviderInput(ctx, 1799, in)
	if err != nil {
		t.Fatal(err)
	}
	if inputStr(upstream, "sourceImage") == src {
		t.Fatal("rotated JPEG was sent without normalization")
	}
	if inputStr(in, "sourceImage") != src {
		t.Fatal("history source was mutated")
	}
	normalized, orientation, err := s.readInpaintRaster(ctx, inputStr(upstream, "sourceImage"))
	if err != nil || orientation != 1 {
		t.Fatalf("normalized source: %d %v", orientation, err)
	}
	visual := orientInpaintImage(decoded, 6)
	for y := 0; y < 3; y++ {
		for x := 0; x < 2; x++ {
			if color.NRGBAModel.Convert(normalized.At(x, y)) != color.NRGBAModel.Convert(visual.At(x, y)) {
				t.Fatal("upstream coordinate mismatch")
			}
		}
	}
	outURL := saveTestPNG(t, s, "generated-rotated.png", image.NewNRGBA(mask.Bounds()))
	result, err := s.composeInpaintResult(ctx, 1799, dto.Input, GenerateResult{ResultURL: outURL})
	if err != nil {
		t.Fatal(err)
	}
	final, err := s.readInpaintImage(ctx, result.ResultURL)
	if err != nil {
		t.Fatal(err)
	}
	for y := 0; y < 3; y++ {
		for x := 0; x < 2; x++ {
			if x == 0 && y == 0 {
				continue
			}
			if color.NRGBAModel.Convert(final.At(x, y)) != color.NRGBAModel.Convert(visual.At(x, y)) {
				t.Fatal("protected oriented pixel changed")
			}
		}
	}
	s.cleanupInpaintProviderSource(1799, in)
	if reader, ok := s.storage.(storage.ObjectReader); ok {
		if body, openErr := reader.Open(ctx, inpaintProviderSourceKey(1799)); openErr == nil {
			_ = body.Close()
			t.Fatal("temporary oriented source was not removed")
		}
	}
}

func TestInpaintOrientationMalformedMetadataDoesNotPanic(t *testing.T) {
	random := rand.New(rand.NewSource(12))
	for n := 0; n < 1024; n++ {
		data := make([]byte, n)
		_, _ = random.Read(data)
		exifOrientation(data)
		for _, format := range []string{"jpeg", "png", "webp"} {
			inpaintOrientation(data, format)
		}
	}
	bad := testExif(6, binary.LittleEndian)
	binary.LittleEndian.PutUint32(bad[4:8], 0xffffffff)
	if exifOrientation(bad) != 1 {
		t.Fatal("out-of-bounds EXIF accepted")
	}
}

func TestInpaintMetadataContainersAndSixteenBitOrientation(t *testing.T) {
	exif := testExif(8, binary.BigEndian)
	// PNG eXIf lengths are big endian; WebP EXIF lengths are little endian
	// and padded to an even byte boundary. These test the metadata readers.
	pngData := []byte{137, 80, 78, 71, 13, 10, 26, 10}
	chunk := make([]byte, 12+len(exif))
	binary.BigEndian.PutUint32(chunk[:4], uint32(len(exif)))
	copy(chunk[4:8], "eXIf")
	copy(chunk[8:], exif)
	pngData = append(pngData, chunk...)
	if inpaintOrientation(pngData, "png") != 8 {
		t.Fatal("PNG eXIf was lost")
	}
	webpData := make([]byte, 20+len(exif))
	copy(webpData, "RIFF")
	binary.LittleEndian.PutUint32(webpData[4:8], uint32(len(webpData)-8))
	copy(webpData[8:12], "WEBP")
	copy(webpData[12:16], "EXIF")
	binary.LittleEndian.PutUint32(webpData[16:20], uint32(len(exif)))
	copy(webpData[20:], exif)
	if inpaintOrientation(webpData, "webp") != 8 {
		t.Fatal("WebP EXIF was lost")
	}
	src := image.NewNRGBA64(image.Rect(0, 0, 2, 1))
	pixel := color.NRGBA64{R: 0x1234, G: 0x4567, B: 0x789a, A: 65535}
	src.SetNRGBA64(0, 0, pixel)
	out := orientInpaintImage(src, 6)
	if color.NRGBA64Model.Convert(out.At(0, 0)) != pixel {
		t.Fatal("orientation quantized 16-bit pixels")
	}
}
