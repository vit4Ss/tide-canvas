package ai

import (
	"bytes"
	"context"
	"encoding/binary"
	"fmt"
	"image"
	"image/color"
	"image/png"
	"tidecanvas/internal/pkg/idgen"
	"time"
)

const inpaintOrientationKey = "_inpaintOrientation"

// Read only the bounded EXIF IFD0 Orientation field, without allocating from
// metadata-controlled counts or offsets. Unknown/malformed metadata is ignored.
func exifOrientation(data []byte) int {
	data = bytes.TrimPrefix(data, []byte("Exif\x00\x00"))
	if len(data) < 8 {
		return 1
	}
	var order binary.ByteOrder
	switch string(data[:2]) {
	case "II":
		order = binary.LittleEndian
	case "MM":
		order = binary.BigEndian
	default:
		return 1
	}
	if order.Uint16(data[2:4]) != 42 {
		return 1
	}
	offset := uint64(order.Uint32(data[4:8]))
	if offset > uint64(len(data))-2 {
		return 1
	}
	count := int(order.Uint16(data[offset : offset+2]))
	for pos := int(offset) + 2; count > 0 && pos <= len(data)-12; count, pos = count-1, pos+12 {
		entry := data[pos : pos+12]
		if order.Uint16(entry[:2]) == 0x0112 && order.Uint16(entry[2:4]) == 3 && order.Uint32(entry[4:8]) == 1 {
			v := int(order.Uint16(entry[8:10]))
			if v >= 1 && v <= 8 {
				return v
			}
			return 1
		}
	}
	return 1
}

func inpaintOrientation(data []byte, format string) int {
	switch format {
	case "jpeg":
		for pos := 2; pos < len(data); {
			if data[pos] != 0xff {
				return 1
			}
			for pos < len(data) && data[pos] == 0xff {
				pos++
			}
			if pos >= len(data) {
				return 1
			}
			marker := data[pos]
			pos++
			if marker == 0xda || marker == 0xd9 {
				return 1
			}
			if marker == 0x01 || (marker >= 0xd0 && marker <= 0xd7) {
				continue
			}
			if pos > len(data)-2 {
				return 1
			}
			size := int(binary.BigEndian.Uint16(data[pos : pos+2]))
			if size < 2 || size > len(data)-pos {
				return 1
			}
			payload := data[pos+2 : pos+size]
			if marker == 0xe1 && bytes.HasPrefix(payload, []byte("Exif\x00\x00")) {
				return exifOrientation(payload)
			}
			pos += size
		}
	case "png":
		for pos := 8; pos <= len(data)-12; {
			size := uint64(binary.BigEndian.Uint32(data[pos : pos+4]))
			if size > uint64(len(data)-pos-12) {
				return 1
			}
			end := pos + 8 + int(size)
			if string(data[pos+4:pos+8]) == "eXIf" {
				return exifOrientation(data[pos+8 : end])
			}
			if string(data[pos+4:pos+8]) == "IEND" {
				return 1
			}
			pos = end + 4
		}
	case "webp":
		if len(data) < 12 {
			return 1
		}
		end := uint64(binary.LittleEndian.Uint32(data[4:8])) + 8
		if end < 12 || end > uint64(len(data)) {
			return 1
		}
		data = data[:int(end)]
		for pos := 12; pos <= len(data)-8; {
			size := uint64(binary.LittleEndian.Uint32(data[pos+4 : pos+8]))
			if size > uint64(len(data)-pos-8) {
				return 1
			}
			end := pos + 8 + int(size)
			if string(data[pos:pos+4]) == "EXIF" {
				return exifOrientation(data[pos+8 : end])
			}
			pos = end + int(size%2)
		}
	}
	return 1
}

// Orthogonal permutations only: no interpolation, no loss of source precision.
func orientInpaintImage(src image.Image, orientation int) image.Image {
	if orientation <= 1 || orientation > 8 {
		return src
	}
	b := src.Bounds()
	w, h := b.Dx(), b.Dy()
	ow, oh := w, h
	if orientation >= 5 {
		ow, oh = h, w
	}
	var out interface {
		image.Image
		Set(int, int, color.Color)
	}
	switch src.(type) {
	case *image.NRGBA64, *image.RGBA64, *image.Gray16, *image.Alpha16:
		out = image.NewNRGBA64(image.Rect(0, 0, ow, oh))
	default:
		out = image.NewNRGBA(image.Rect(0, 0, ow, oh))
	}
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			dx, dy := x, y
			switch orientation {
			case 2:
				dx = w - 1 - x
			case 3:
				dx, dy = w-1-x, h-1-y
			case 4:
				dy = h - 1 - y
			case 5:
				dx, dy = y, x
			case 6:
				dx, dy = h-1-y, x
			case 7:
				dx, dy = h-1-y, w-1-x
			case 8:
				dx, dy = y, w-1-x
			}
			out.Set(dx, dy, src.At(b.Min.X+x, b.Min.Y+y))
		}
	}
	return out
}

// The orientation hint is computed by validateInpaint, never trusted from the
// caller. Only oriented sources need a lossless, orientation-free upstream copy.
func (s *service) prepareInpaintProviderInput(ctx context.Context, taskID idgen.ID, input map[string]any) (map[string]any, error) {
	if _, masked := input["maskImage"]; !masked || inputInt(input, inpaintOrientationKey) <= 1 {
		return input, nil
	}
	ctx, cancel := context.WithTimeout(ctx, 2*time.Minute)
	defer cancel()
	select {
	case inpaintSlots <- struct{}{}:
		defer func() { <-inpaintSlots }()
	case <-ctx.Done():
		return nil, ctx.Err()
	}
	urls := inputImageURLs(input)
	if len(urls) != 1 {
		return nil, fmt.Errorf("inpaint source missing")
	}
	source, err := s.readInpaintImage(ctx, urls[0])
	if err != nil {
		return nil, err
	}
	var buffer bytes.Buffer
	if err = png.Encode(&buffer, source); err != nil {
		return nil, err
	}
	if buffer.Len() > maxInpaintBytes {
		return nil, fmt.Errorf("normalized source exceeds image limit")
	}
	url, err := s.storage.Save(ctx, inpaintProviderSourceKey(taskID), &buffer, "image/png")
	if err != nil {
		return nil, err
	}
	out := make(map[string]any, len(input))
	for key, value := range input {
		out[key] = value
	}
	for _, key := range []string{"image_urls", "imageUrls", "imageUrl", "image_url", "references"} {
		delete(out, key)
	}
	out["imageList"] = []string{url}
	out["sourceImage"] = url
	return out, nil
}

func inpaintProviderSourceKey(taskID idgen.ID) string {
	return "gen/inpaint-source/" + taskID.String() + ".png"
}

func (s *service) cleanupInpaintProviderSource(taskID idgen.ID, input map[string]any) {
	if s.storage == nil || inputInt(input, inpaintOrientationKey) <= 1 {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	_ = s.storage.Delete(ctx, inpaintProviderSourceKey(taskID))
}
