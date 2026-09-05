package file

import (
	"net/http"
	"testing"
)

func TestRemoteAssetRequestBilibiliHeadersAreHostScoped(t *testing.T) {
	for _, tc := range []struct {
		host string
		want bool
	}{
		{"upos-sz-mirror08c.bilivideo.com", true},
		{"BILIVIDEO.com.", true},
		{"bilivideo.com.evil.example", false},
		{"fakebilivideo.com", false},
		{"cdn.example", false},
	} {
		t.Run(tc.host, func(t *testing.T) {
			req, _ := http.NewRequest(http.MethodGet, "https://"+tc.host+"/video.mp4", nil)
			req.Header.Set("Range", "bytes=0-63")
			got := remoteAssetRequest(req)
			if (got.Header.Get("Referer") == "https://www.bilibili.com/") != tc.want {
				t.Fatalf("unexpected Referer for %s", tc.host)
			}
			if tc.want && got.Header.Get("User-Agent") != "Mozilla/5.0" {
				t.Fatal("missing media user agent")
			}
			if req.Header.Get("Referer") != "" || got.Header.Get("Range") != "bytes=0-63" {
				t.Fatal("mutated the caller's headers or lost range")
			}
		})
	}
}
