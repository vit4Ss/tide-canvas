package ai

// grid.go implements real server-side image grid splitting: it downloads the
// source image, cuts it into rows×cols cells, uploads each requested cell as a
// PNG to the configured storage backend, and returns their public URLs. The
// frontend keeps its client-side canvas slicer (lib/image-slice.ts) as the
// primary fast path; this server path is the durable fallback (e.g. when the
// caller needs the cells persisted on OSS rather than as ephemeral blob URLs).

import (
	"bytes"
	"context"
	"fmt"
	"image"
	"image/draw"
	_ "image/gif"  // register GIF decoder for image.Decode
	_ "image/jpeg" // register JPEG decoder for image.Decode
	"image/png"
)

// maxGridCells caps how many cells one request may produce, bounding memory /
// upload fan-out from a hostile rows*cols.
const maxGridCells = 64

// maxGridSide bounds rows/cols so rows*cols can't overflow int or drive a large
// index allocation. maxGridDim / maxGridPixels bound a user-supplied source
// image's *decoded* dimensions (probed via image.DecodeConfig before the full
// decode) so a small "decompression bomb" that declares e.g. 100000×100000
// can't make image.Decode pre-allocate tens of GB. 64 MP ≈ 256 MB as RGBA.
const (
	maxGridSide   = 64
	maxGridDim    = 20000
	maxGridPixels = 64 << 20
)

// sliceGrid's storage key uses sha1Hex(srcURL) — sha1Hex lives in
// provider_relay.go (same package) alongside the other URL-hashing helpers.

// sliceGrid decodes data, cuts it into a rows×cols grid and stores each selected
// cell. When cells is empty every cell is produced in row-major order; otherwise
// only the listed 0-based indices are produced, in the given order. Returns the
// stored public URLs aligned to the produced cell order.
func (s *service) sliceGrid(ctx context.Context, srcURL string, data []byte, rows, cols int, cells []int) ([]string, error) {
	if s.storage == nil {
		return nil, errGridSplitUnavailable
	}

	// Probe the header only (no pixel buffer allocated) and reject oversized
	// images before the full decode, so a decompression-bomb file can't drive
	// image.Decode to pre-allocate an enormous pixel buffer and OOM the process.
	cfg, _, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil {
		return nil, fmt.Errorf("%w: %v", errGridSplitUnavailable, err)
	}
	if cfg.Width <= 0 || cfg.Height <= 0 ||
		cfg.Width > maxGridDim || cfg.Height > maxGridDim ||
		int64(cfg.Width)*int64(cfg.Height) > maxGridPixels {
		return nil, errBadGridSplit
	}

	img, _, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		return nil, fmt.Errorf("%w: %v", errGridSplitUnavailable, err)
	}

	b := img.Bounds()
	w, h := b.Dx(), b.Dy()
	if w < cols || h < rows {
		// Image too small to yield one pixel per cell.
		return nil, errBadGridSplit
	}

	// Resolve the target cell indices. Bound the produced-cell count *before*
	// allocating the index slice, so a large rows*cols with cells omitted is
	// rejected rather than first allocating a rows*cols-sized buffer.
	total := rows * cols
	want := cells
	if len(want) == 0 {
		if total > maxGridCells {
			return nil, errBadGridSplit
		}
		want = make([]int, 0, total)
		for i := 0; i < total; i++ {
			want = append(want, i)
		}
	}
	if len(want) > maxGridCells {
		return nil, errBadGridSplit
	}

	// A concrete decoded image implements SubImage; if not, copy into an RGBA
	// once so cropping still works.
	type subImager interface {
		SubImage(r image.Rectangle) image.Image
	}
	si, ok := img.(subImager)
	if !ok {
		rgba := image.NewRGBA(b)
		draw.Draw(rgba, b, img, b.Min, draw.Src)
		si = rgba
	}

	urls := make([]string, 0, len(want))
	for _, idx := range want {
		if idx < 0 || idx >= total {
			return nil, errBadGridSplit
		}
		r := idx / cols
		c := idx % cols
		// Proportional boundaries so rounding never leaves gaps/overlaps.
		x0 := b.Min.X + c*w/cols
		x1 := b.Min.X + (c+1)*w/cols
		y0 := b.Min.Y + r*h/rows
		y1 := b.Min.Y + (r+1)*h/rows
		cell := si.SubImage(image.Rect(x0, y0, x1, y1))

		var buf bytes.Buffer
		if err := png.Encode(&buf, cell); err != nil {
			return nil, fmt.Errorf("%w: encode cell %d: %v", errGridSplitUnavailable, idx, err)
		}
		key := fmt.Sprintf("grid/%s/%dx%d_%d.png", sha1Hex(srcURL), rows, cols, idx)
		url, err := s.storage.Save(ctx, key, bytes.NewReader(buf.Bytes()), "image/png")
		if err != nil {
			return nil, fmt.Errorf("%w: store cell %d: %v", errGridSplitUnavailable, idx, err)
		}
		urls = append(urls, url)
	}
	return urls, nil
}
