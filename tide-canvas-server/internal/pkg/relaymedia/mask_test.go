package relaymedia

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestEditImageSendsMaskWithoutChangingOrdinaryEdits(t *testing.T) {
	var seen []map[string]any
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Error(err)
		}
		seen = append(seen, body)
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprint(w, `{"data":[{"url":"https://cdn.test/result.png"}]}`)
	}))
	defer srv.Close()
	client := New(srv.URL, "test-key")
	for _, mask := range []string{"https://cdn.test/mask.png", ""} {
		_, err := client.EditImage(context.Background(), ImageParams{Model: "image", Prompt: "axe", ImageURLs: []string{"https://cdn.test/source.png"}, MaskURL: mask})
		if err != nil {
			t.Fatal(err)
		}
	}
	if seen[0]["mask"] != "https://cdn.test/mask.png" {
		t.Fatal("mask lost")
	}
	if _, exists := seen[1]["mask"]; exists {
		t.Fatal("ordinary edit unexpectedly has a mask")
	}
}
