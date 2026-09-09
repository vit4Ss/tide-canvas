package file

import (
	"bytes"
	"encoding/json"
	"image"
	"image/color"
	"image/draw"
	"image/png"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"

	"tidecanvas/internal/middleware"
	"tidecanvas/internal/model"
)

// Exercise the same sparse transparent PNG shape produced by the browser mask
// editor through the real multipart handler, MIME validation, storage and DB.
func TestInpaintMaskMultipartUploadReturnsJSON(t *testing.T) {
	svc, db, _, user, _ := newDedupTestService(t)
	mask := image.NewNRGBA(image.Rect(0, 0, 2048, 1024))
	draw.Draw(mask, mask.Bounds(), image.NewUniform(color.NRGBA{A: 255}), image.Point{}, draw.Src)
	for y := 360; y < 664; y++ {
		for x := 420; x < 724; x++ {
			if dx, dy := x-572, y-512; dx*dx+dy*dy < 152*152 {
				mask.SetNRGBA(x, y, color.NRGBA{})
			}
		}
	}

	var encoded bytes.Buffer
	if err := png.Encode(&encoded, mask); err != nil {
		t.Fatal(err)
	}
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	part, err := writer.CreateFormFile("file", "inpaint-mask.png")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = part.Write(encoded.Bytes()); err != nil {
		t.Fatal(err)
	}
	if err = writer.Close(); err != nil {
		t.Fatal(err)
	}

	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = httptest.NewRequest(http.MethodPost, "/api/files/upload", &body)
	ctx.Request.Header.Set("Content-Type", writer.FormDataContentType())
	ctx.Set(middleware.CtxUserID, user.ID)
	ctx.Set(middleware.CtxRequestID, "mask-upload-test")
	(&handler{svc: svc}).upload(ctx)

	if recorder.Code != http.StatusOK || !strings.Contains(recorder.Header().Get("Content-Type"), "application/json") {
		t.Fatalf("status=%d content-type=%q body=%s", recorder.Code, recorder.Header().Get("Content-Type"), recorder.Body.String())
	}
	var envelope struct {
		Success bool   `json:"success"`
		Message string `json:"message"`
		Data    FileVO `json:"data"`
	}
	if err = json.Unmarshal(recorder.Body.Bytes(), &envelope); err != nil {
		t.Fatalf("response is not JSON: %v body=%s", err, recorder.Body.String())
	}
	if !envelope.Success || envelope.Data.MimeType != "image/png" || envelope.Data.FileURL == "" {
		t.Fatalf("unexpected upload response: %#v", envelope)
	}
	var count int64
	if err = db.Model(&model.File{}).Count(&count).Error; err != nil || count != 1 {
		t.Fatalf("stored files=%d err=%v", count, err)
	}
}
