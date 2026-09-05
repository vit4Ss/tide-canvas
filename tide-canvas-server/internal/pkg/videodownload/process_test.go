package videodownload

import (
	"bytes"
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestVideoCommandHelper(t *testing.T) {
	for i, arg := range os.Args {
		if arg != "--video-helper" || i+1 >= len(os.Args) {
			continue
		}
		switch os.Args[i+1] {
		case "output":
			_, _ = os.Stdout.Write(bytes.Repeat([]byte("x"), 9<<20))
		case "disk", "fast-disk":
			_ = os.WriteFile("oversize.bin", make([]byte, 8192), 0600)
			if os.Args[i+1] == "fast-disk" {
				os.Exit(0)
			}
		}
		time.Sleep(20 * time.Second)
		os.Exit(0)
	}
}

func TestCommandCancellationAndResourceLimits(t *testing.T) {
	binary, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	for _, mode := range []string{"sleep", "output", "disk", "fast-disk"} {
		t.Run(mode, func(t *testing.T) {
			duration := 5 * time.Second
			if mode == "sleep" {
				duration = 300 * time.Millisecond
			}
			ctx, cancel := context.WithTimeout(context.Background(), duration)
			defer cancel()
			dir := t.TempDir()
			started := time.Now()
			stdout, _, err := runCommand(ctx, binary, []string{"-test.run=^TestVideoCommandHelper$", "--", "--video-helper", mode}, dir, 1024)
			if err == nil || time.Since(started) > 8*time.Second {
				t.Fatalf("command cancellation or resource limit not enforced: %v", err)
			}
			if mode == "output" && (!strings.Contains(err.Error(), "output limit") || len(stdout) > 8<<20) {
				t.Fatalf("output was not bounded: bytes=%d err=%v", len(stdout), err)
			}
			if mode == "disk" || mode == "fast-disk" {
				requireError(t, err, 400)
				if _, statErr := os.Stat(filepath.Join(dir, "oversize.bin")); statErr != nil {
					t.Fatal("helper never wrote its output", statErr)
				}
			}
		})
	}
}
