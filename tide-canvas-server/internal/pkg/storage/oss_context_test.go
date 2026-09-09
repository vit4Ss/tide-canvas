package storage

import (
	"context"
	"errors"
	"github.com/aliyun/aliyun-oss-go-sdk/oss"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestOSSReadsAndWritesHonorCallerCancellation(t *testing.T) {
	for _, operation := range []string{"read", "write", "delete"} {
		t.Run(operation, func(t *testing.T) {
			arrived := make(chan struct{})
			release := make(chan struct{})
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				close(arrived)
				select {
				case <-release:
				case <-r.Context().Done():
				}
				w.WriteHeader(http.StatusOK)
			}))
			defer server.Close()
			defer close(release)
			client, err := oss.New(server.URL, "test-id", "test-secret", oss.ForcePathStyle(true))
			if err != nil {
				t.Fatal(err)
			}
			bucket, err := client.Bucket("test-bucket")
			if err != nil {
				t.Fatal(err)
			}
			store := &OSSStorage{bucket: bucket, publicBase: server.URL}
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			done := make(chan error, 1)
			go func() {
				if operation == "read" {
					body, err := store.Open(ctx, "source.png")
					if body != nil {
						_ = body.Close()
					}
					done <- err
				} else if operation == "write" {
					_, err := store.Save(ctx, "result.png", strings.NewReader("png"), "image/png")
					done <- err
				} else {
					done <- store.Delete(ctx, "result.png")
				}
			}()
			select {
			case <-arrived:
			case <-time.After(3 * time.Second):
				t.Fatal("OSS request never arrived")
			}
			cancel()
			select {
			case err := <-done:
				if !errors.Is(err, context.Canceled) {
					t.Fatalf("cancellation lost: %v", err)
				}
			case <-time.After(2 * time.Second):
				t.Fatal("OSS ignored caller cancellation")
			}
		})
	}
}
