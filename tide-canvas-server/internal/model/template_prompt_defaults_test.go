package model

import "testing"

func TestTemplateVideoHeaderDefaults(t *testing.T) {
	for _, tc := range []struct {
		prompt   string
		duration float64
		ratio    string
	}{
		{"【生成视频：30秒｜9:16】\n镜头描述", 30, "9:16"},
		{" \ufeff[生成视频: 15 秒 | 16：9 横屏]\r\n30秒备选", 15, "16:9"},
		{"生成视频：4.5秒｜1:1", 4.5, "1:1"},
		{"生成视频：30秒", 30, ""},
		{"生成视频：600秒｜16:9", 600, "16:9"},
		{"生成视频：601秒｜16:9", 0, ""},
		{"生成视频：0秒｜16:9", 0, ""},
		{"海报\n【生成视频：30秒｜9:16】", 0, ""},
		{"请参考30秒的视频", 0, ""},
	} {
		got := TemplateVideoPromptOptions(tc.prompt)
		if got.Duration != tc.duration || got.AspectRatio != tc.ratio {
			t.Fatalf("%q: %+v", tc.prompt, got)
		}
	}
	row := StudioTemplate{MediaType: "video", Prompt: "【生成视频：30秒｜9:16】"}
	got := WithTemplatePromptDefaults(row)
	if got.Options.Duration != 30 || got.Options.AspectRatio != "9:16" || !TemplatePrefersSeedance25(got) {
		t.Fatal("video defaults missing", got.Options)
	}
	row.Options = StudioTemplateOptions{Duration: 15, AspectRatio: "16:9", Resolution: "1080p"}
	if got := WithTemplatePromptDefaults(row); got.Options != row.Options || TemplatePrefersSeedance25(got) {
		t.Fatal("manual specifications overwritten")
	}
	row.MediaType, row.Options = "image", StudioTemplateOptions{}
	if WithTemplatePromptDefaults(row).Options != row.Options {
		t.Fatal("image template changed")
	}
	for _, key := range []string{"Seedance 2.5", "doubao-seedance-2-5-260628", "gmj-video-seedance-2.5-vip"} {
		if !IsTemplateSeedance25(key, "") {
			t.Fatal("missed model", key)
		}
	}
	for _, key := range []string{"seedance-2.0", "seedance-2.50", "seedance-25", "notseedance-2.5"} {
		if IsTemplateSeedance25(key, "") {
			t.Fatal("matched another version", key)
		}
	}
}
