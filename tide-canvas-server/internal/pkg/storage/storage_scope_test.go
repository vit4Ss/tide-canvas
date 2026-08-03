package storage

import (
	"strings"
	"testing"

	"tidecanvas/internal/config"
)

func TestScopeIDTracksPhysicalNamespaceWithoutCredentials(t *testing.T) {
	base := config.StorageConfig{
		Type: "oss", Endpoint: "https://oss-cn-test.aliyuncs.com/",
		Bucket: "example-bucket", Prefix: "canvas/uploads",
		AccessKey: "first-access", SecretKey: "first-secret",
		CDNDomain: "https://cdn-one.example.com",
	}
	got := ScopeID(base)
	if !strings.HasPrefix(got, "oss:") || len(got) != len("oss:")+64 {
		t.Fatalf("unexpected scope id %q", got)
	}

	credentialsChanged := base
	credentialsChanged.AccessKey = "second-access"
	credentialsChanged.SecretKey = "second-secret"
	credentialsChanged.CDNDomain = "https://cdn-two.example.com"
	if other := ScopeID(credentialsChanged); other != got {
		t.Fatalf("credentials or display domain changed physical scope: %q != %q", other, got)
	}

	prefixChanged := base
	prefixChanged.Prefix = "another-prefix"
	if other := ScopeID(prefixChanged); other == got {
		t.Fatal("different object prefix produced the same storage scope")
	}

	bucketChanged := base
	bucketChanged.Bucket = "another-bucket"
	if other := ScopeID(bucketChanged); other == got {
		t.Fatal("different bucket produced the same storage scope")
	}
}
