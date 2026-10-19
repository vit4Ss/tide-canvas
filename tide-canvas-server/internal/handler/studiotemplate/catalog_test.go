package studiotemplate

import (
	"testing"
	"tidecanvas/internal/model"
)

func TestRequirementsRejectImpossibleInputs(t *testing.T) {
	base := SaveDTO{Kind: "inspiration", MediaType: "image", Title: "Edit", Prompt: "replace clothing", Mode: "i2i", Status: 0}
	if err := base.Validate(); err != nil || base.Requirements.Images != 1 {
		t.Fatal("image edit needs a source image", err)
	}
	for _, test := range []struct {
		mode, media string
		r           model.StudioTemplateRequirements
	}{
		{"t2i", "image", model.StudioTemplateRequirements{Images: 1}},
		{"i2i", "image", model.StudioTemplateRequirements{Videos: 1}},
		{"i2v", "video", model.StudioTemplateRequirements{Images: 2}},
		{"ref", "video", model.StudioTemplateRequirements{Audio: 4}},
		{"i2i", "image", model.StudioTemplateRequirements{Images: 5}},
		{"ref", "video", model.StudioTemplateRequirements{Images: -1}},
	} {
		dto := base
		dto.Mode = test.mode
		dto.MediaType = test.media
		dto.Requirements = test.r
		if dto.Validate() == nil {
			t.Fatalf("impossible requirements accepted: %+v", test)
		}
	}
	for _, raw := range []string{"javascript:alert(1)", "data:image/svg+xml,x", "//other.test/a", "https://user:pass@host.test/image", "https://a.test\\b"} {
		if SafeMediaURL(raw) {
			t.Errorf("unsafe URL allowed: %s", raw)
		}
	}
}
