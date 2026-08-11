package admin

import "testing"

func TestValidToolCoverURL(t *testing.T) {
	tests := []struct {
		name string
		url  string
		want bool
	}{
		{name: "https", url: "https://cdn.example/tool.webp", want: true},
		{name: "http", url: "http://localhost:3000/tool.png", want: true},
		{name: "site path", url: "/api/files/tool.jpg", want: true},
		{name: "protocol relative", url: "//cdn.example/tool.jpg", want: false},
		{name: "relative", url: "images/tool.jpg", want: false},
		{name: "javascript", url: "javascript:alert(1)", want: false},
		{name: "data", url: "data:image/png;base64,AA==", want: false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := validToolCoverURL(tt.url); got != tt.want {
				t.Fatalf("validToolCoverURL(%q) = %v, want %v", tt.url, got, tt.want)
			}
		})
	}
}
