package admin

import (
	"testing"

	"tidecanvas/internal/model"
)

func TestAdminWorkVOIncludesPlayableMediaURLs(t *testing.T) {
	tests := []struct {
		name      string
		content   string
		wantType  string
		wantVideo string
		wantAudio string
	}{
		{
			name:      "video",
			content:   `{"type":"video","model":"Video Model","videoUrl":"https://cdn.example/work.mp4"}`,
			wantType:  "video",
			wantVideo: "https://cdn.example/work.mp4",
		},
		{
			name:      "audio",
			content:   `{"type":"audio","model":"Audio Model","audioUrl":"https://cdn.example/work.mp3"}`,
			wantType:  "audio",
			wantAudio: "https://cdn.example/work.mp3",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			post := &model.CommunityPost{Content: tt.content}
			vo := (&worksHandler{}).toVO(post, nil, 0)
			if vo.VideoURL != tt.wantVideo {
				t.Fatalf("videoUrl = %q, want %q", vo.VideoURL, tt.wantVideo)
			}
			if vo.AudioURL != tt.wantAudio {
				t.Fatalf("audioUrl = %q, want %q", vo.AudioURL, tt.wantAudio)
			}
			if vo.Type != tt.wantType {
				t.Fatalf("type = %q, want %q", vo.Type, tt.wantType)
			}
		})
	}
}
