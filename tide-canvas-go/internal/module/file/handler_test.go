package file

import (
	"bytes"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/tidecanvas/tide-canvas-go/pkg/ecode"
)

func multipartHeader(t *testing.T, content []byte) *multipart.FileHeader {
	t.Helper()
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	part, err := writer.CreateFormFile("file", "test.bin")
	if err != nil {
		t.Fatalf("CreateFormFile: %v", err)
	}
	if _, err := part.Write(content); err != nil {
		t.Fatalf("Write: %v", err)
	}
	if err := writer.Close(); err != nil {
		t.Fatalf("Close: %v", err)
	}
	req := httptest.NewRequest(http.MethodPost, "/upload", &body)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	if err := req.ParseMultipartForm(32 << 20); err != nil {
		t.Fatalf("ParseMultipartForm: %v", err)
	}
	return req.MultipartForm.File["file"][0]
}

func TestReadMultipartWithinLimit(t *testing.T) {
	fh := multipartHeader(t, []byte("hello"))
	data, err := readMultipart(fh, 5)
	if err != nil {
		t.Fatalf("readMultipart returned error: %v", err)
	}
	if string(data) != "hello" {
		t.Fatalf("unexpected data %q", string(data))
	}
}

func TestReadMultipartRejectsOversizedUpload(t *testing.T) {
	fh := multipartHeader(t, []byte("toolarge"))
	_, err := readMultipart(fh, 5)
	if err != ecode.FileSizeExceeded {
		t.Fatalf("expected FileSizeExceeded, got %v", err)
	}
}
