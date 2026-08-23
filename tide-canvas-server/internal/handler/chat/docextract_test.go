package chat

import "testing"

func TestToAttachesPreservesOriginalFilename(t *testing.T) {
	converted := toAttaches([]MessageAttach{{
		URL:  " https://cdn.example.test/uploads/2090636035846311937.docx ",
		Kind: " file ",
		Name: " 原始镜头提示词.docx ",
	}})
	if len(converted) != 1 {
		t.Fatalf("converted attachments = %#v", converted)
	}
	if converted[0].Name != "原始镜头提示词.docx" || converted[0].Kind != "file" {
		t.Fatalf("converted attachment = %#v", converted[0])
	}
}
