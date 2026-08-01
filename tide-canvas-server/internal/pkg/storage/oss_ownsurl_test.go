package storage

import "testing"

// OwnsURL decides whether the relay-rehost fast path may reference a result URL
// in place (zero-copy) or must still download + re-upload it. The shared bucket
// hosts several projects, so the project prefix — not just the host — is what
// makes a URL "ours".
func TestOSSOwnsURL(t *testing.T) {
	o := &OSSStorage{
		prefix:         "canvas/uploads",
		publicBase:     "https://scaecrowtoken.oss-cn-shanghai.aliyuncs.com",
		regionalBase:   "https://scaecrowtoken.oss-cn-shanghai.aliyuncs.com",
		accelerateBase: "https://scaecrowtoken.oss-accelerate.aliyuncs.com",
	}

	const want = "https://scaecrowtoken.oss-cn-shanghai.aliyuncs.com/canvas/uploads/u1/up_1_task.png"

	cases := []struct {
		name string
		url  string
		ok   bool
	}{
		{"regional host, own prefix", "https://scaecrowtoken.oss-cn-shanghai.aliyuncs.com/canvas/uploads/u1/up_1_task.png", true},
		{"accelerate host, own prefix (relay prod returns this variant)", "https://scaecrowtoken.oss-accelerate.aliyuncs.com/canvas/uploads/u1/up_1_task.png", true},
		{"query string dropped from canonical", "https://scaecrowtoken.oss-accelerate.aliyuncs.com/canvas/uploads/u1/up_1_task.png?x=1", true},
		{"relay's own uploads/ dir in the shared bucket is NOT ours", "https://scaecrowtoken.oss-cn-shanghai.aliyuncs.com/uploads/u1/up_1_task.png", false},
		{"sibling project prefix is NOT ours", "https://scaecrowtoken.oss-cn-shanghai.aliyuncs.com/other/uploads/u1/up_1_task.png", false},
		{"prefix must be a path segment, not a string prefix", "https://scaecrowtoken.oss-cn-shanghai.aliyuncs.com/canvas/uploadsx/u1.png", false},
		{"foreign host", "https://cdn.example.com/canvas/uploads/u1/up_1_task.png", false},
		{"empty", "", false},
		{"not a url", "canvas/uploads/u1.png", false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got, ok := o.OwnsURL(c.url)
			if ok != c.ok {
				t.Fatalf("OwnsURL(%q) ok=%v, want %v", c.url, ok, c.ok)
			}
			if ok && got != want {
				t.Fatalf("OwnsURL(%q) canonical=%q, want %q", c.url, got, want)
			}
		})
	}

	t.Run("cdn public base is recognized and kept as canonical", func(t *testing.T) {
		withCDN := &OSSStorage{
			prefix:         "canvas/uploads",
			publicBase:     "https://cdn.example.com",
			regionalBase:   "https://scaecrowtoken.oss-cn-shanghai.aliyuncs.com",
			accelerateBase: "https://scaecrowtoken.oss-accelerate.aliyuncs.com",
		}
		got, ok := withCDN.OwnsURL("https://cdn.example.com/canvas/uploads/u1/up_1_task.png")
		if !ok || got != "https://cdn.example.com/canvas/uploads/u1/up_1_task.png" {
			t.Fatalf("got %q, %v", got, ok)
		}
		// inbound on the accelerate host still canonicalizes to the CDN base
		got, ok = withCDN.OwnsURL("https://scaecrowtoken.oss-accelerate.aliyuncs.com/canvas/uploads/u1/up_1_task.png")
		if !ok || got != "https://cdn.example.com/canvas/uploads/u1/up_1_task.png" {
			t.Fatalf("got %q, %v", got, ok)
		}
	})

	t.Run("prefix-less bucket owns every path on its hosts", func(t *testing.T) {
		noPfx := &OSSStorage{
			publicBase:   "https://b.oss-cn-shanghai.aliyuncs.com",
			regionalBase: "https://b.oss-cn-shanghai.aliyuncs.com",
		}
		if _, ok := noPfx.OwnsURL("https://b.oss-cn-shanghai.aliyuncs.com/anything/here.png"); !ok {
			t.Fatal("want owned")
		}
		if _, ok := noPfx.OwnsURL("https://b.oss-cn-shanghai.aliyuncs.com/"); ok {
			t.Fatal("root path is not an object")
		}
	})
}
