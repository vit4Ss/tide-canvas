package videodownload

import (
	"bytes"
	"context"
	"encoding/binary"
	"encoding/json"
	"io"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"tidecanvas/internal/config"
)

func TestRealExtractorQualityFallback(t *testing.T) {
	binary, err := exec.LookPath("yt-dlp")
	if err != nil {
		t.Skip("yt-dlp not installed")
	}
	for _, scenario := range []string{"unknown-height", "high-only", "prefer-low"} {
		for _, quality := range []string{"compat", "speed"} {
			t.Run(scenario+"/"+quality, func(t *testing.T) {
				format := map[string]any{"format_id": "source", "url": "https://media.example.org/video.mp4", "ext": "mp4", "vcodec": "avc1", "acodec": "aac"}
				if scenario != "unknown-height" {
					format["height"], format["width"] = 2160, 3840
				}
				formats := []any{format}
				want := "source"
				if scenario == "prefer-low" {
					formats = append(formats, map[string]any{"format_id": "low", "url": "https://media.example.org/low.mp4", "ext": "mp4", "vcodec": "avc1", "acodec": "aac", "height": 360, "width": 640})
					want = "low"
				}
				data, err := json.Marshal(map[string]any{"id": "fixture", "title": "quality fixture", "extractor": "generic", "extractor_key": "Generic", "webpage_url": "https://example.org/video", "formats": formats})
				if err != nil {
					t.Fatal(err)
				}
				dir := t.TempDir()
				info := filepath.Join(dir, "info.json")
				if err = os.WriteFile(info, data, 0600); err != nil {
					t.Fatal(err)
				}
				ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
				defer cancel()
				out, stderr, err := runCommand(ctx, binary, []string{"--ignore-config", "--no-plugin-dirs", "--no-cache-dir", "--no-check-formats", "--simulate", "--load-info-json", info, "--format", formatSelector(quality), "--print", "format_id"}, dir, 1<<20)
				if err != nil || strings.TrimSpace(string(out)) != want {
					t.Fatalf("selected=%q want=%s err=%v stderr=%s", out, want, err, stderr)
				}
			})
		}
	}
}

// Run when the normal deployment media tools are installed. This covers real
// remux/scale/audio output, rather than trusting command-line mocks alone.
func TestRealMediaDownloadPipeline(t *testing.T) {
	ffmpeg, err := exec.LookPath("ffmpeg")
	if err != nil {
		t.Skip("ffmpeg not installed")
	}
	ffprobe, err := exec.LookPath("ffprobe")
	if err != nil {
		t.Skip("ffprobe not installed")
	}
	binary, _ := os.Executable()
	dir := t.TempDir()
	source := filepath.Join(dir, "fixture.mp4")
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	_, stderr, err := runCommand(ctx, ffmpeg, []string{"-nostdin", "-v", "error", "-y", "-f", "lavfi", "-i", "color=c=blue:s=1630x1920:r=1:d=1", "-f", "lavfi", "-i", "sine=frequency=440:duration=1", "-c:v", "libx264", "-threads", "2", "-pix_fmt", "yuv420p", "-c:a", "aac", source}, dir, 64<<20)
	if err != nil {
		t.Fatalf("fixture: %v %s", err, stderr)
	}
	s := New(config.VideoDownloaderConfig{Enabled: true, Command: binary, FFmpegCommand: ffmpeg, FFprobeCommand: ffprobe, JSRuntime: binary, TempDir: t.TempDir()})
	s.client.Transport = roundTripFunc(func(r *http.Request) (*http.Response, error) {
		if r.URL.Host == "v.kuaishou.com" {
			return responseFor(r, `<video src="https://v.kwimgs.com/source.mp4"></video>`, "text/html"), nil
		}
		f, err := os.Open(source)
		if err != nil {
			return nil, err
		}
		st, _ := f.Stat()
		return &http.Response{StatusCode: 200, Request: r, Header: http.Header{"Content-Type": []string{"video/mp4"}}, Body: f, ContentLength: st.Size()}, nil
	})
	f, err := s.Download(ctx, "https://v.kuaishou.com/fixture", "speed")
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	if f.Size <= 0 {
		t.Fatal("empty attachment")
	}
	out, stderr, err := runCommand(ctx, ffprobe, []string{"-v", "error", "-show_entries", "stream=codec_type,codec_name,width,height", "-of", "json", f.Name()}, dir, 64<<20)
	if err != nil {
		t.Fatalf("probe: %v %s", err, stderr)
	}
	var data struct {
		Streams []struct {
			Codec  string `json:"codec_name"`
			Type   string `json:"codec_type"`
			Height int    `json:"height"`
			Width  int    `json:"width"`
		} `json:"streams"`
	}
	if json.Unmarshal(out, &data) != nil {
		t.Fatal(string(out))
	}
	video, audio := false, false
	preview := outputMetadata(Metadata{Width: 1630, Height: 1920}, "speed")
	for _, stream := range data.Streams {
		if stream.Type == "video" {
			video = stream.Height == 480 && stream.Codec == "h264" && stream.Width == preview.Width && preview.Width == 408
		}
		if stream.Type == "audio" {
			audio = stream.Codec == "aac"
		}
	}
	if !video || !audio {
		t.Fatalf("lost codec/size/audio: %s", out)
	}
	if _, err = io.Copy(io.Discard, f); err != nil {
		t.Fatal(err)
	}
	f.Close()
	entries, _ := os.ReadDir(s.cfg.TempDir)
	if len(entries) != 0 {
		t.Fatal("media staging was not cleaned")
	}
}

func TestRealCompatConvertsUnsupportedH264PixelFormat(t *testing.T) {
	ffmpeg, err := exec.LookPath("ffmpeg")
	if err != nil {
		t.Skip("ffmpeg not installed")
	}
	ffprobe, err := exec.LookPath("ffprobe")
	if err != nil {
		t.Skip("ffprobe not installed")
	}
	s := New(config.VideoDownloaderConfig{FFmpegCommand: ffmpeg, FFprobeCommand: ffprobe})
	dir := t.TempDir()
	source, target := filepath.Join(dir, "444.mp4"), filepath.Join(dir, "compatible.mp4")
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	_, stderr, err := runCommand(ctx, ffmpeg, []string{"-nostdin", "-v", "error", "-f", "lavfi", "-i", "color=c=blue:s=192x108:r=1:d=1", "-c:v", "libx264", "-threads", "2", "-pix_fmt", "yuv444p", source}, dir, 1<<20)
	if err != nil {
		t.Fatalf("fixture: %v %s", err, stderr)
	}
	if err := s.finish(ctx, []string{source}, false, "compat", dir, target); err != nil {
		t.Fatal(err)
	}
	out, stderr, err := runCommand(ctx, ffprobe, []string{"-v", "error", "-show_entries", "stream=codec_name,pix_fmt", "-of", "json", target}, dir, 1<<20)
	if err != nil || !strings.Contains(string(out), `"pix_fmt": "yuv420p"`) || !strings.Contains(string(out), `"codec_name": "h264"`) {
		t.Fatalf("incompatible MP4: %s err=%v stderr=%s", out, err, stderr)
	}
}

func TestRealMultipartAndSeparateAudio(t *testing.T) {
	ffmpeg, err := exec.LookPath("ffmpeg")
	if err != nil {
		t.Skip("ffmpeg not installed")
	}
	ffprobe, err := exec.LookPath("ffprobe")
	if err != nil {
		t.Skip("ffprobe not installed")
	}
	dir := t.TempDir()
	ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
	defer cancel()
	run := func(args ...string) {
		t.Helper()
		_, stderr, err := runCommand(ctx, ffmpeg, append([]string{"-nostdin", "-v", "error", "-y"}, args...), dir, 10<<20)
		if err != nil {
			t.Fatalf("fixture failed: %v %s", err, stderr)
		}
	}
	source := filepath.Join(dir, "source.mp4")
	video, audio := filepath.Join(dir, "video.mp4"), filepath.Join(dir, "audio.m4a")
	run("-f", "lavfi", "-i", "color=c=blue:s=320x240:r=10:d=1", "-f", "lavfi", "-i", "sine=frequency=440:duration=1", "-c:v", "libx264", "-threads", "2", "-pix_fmt", "yuv420p", "-c:a", "aac", source)
	run("-i", source, "-map", "0:v:0", "-c", "copy", video)
	run("-i", source, "-map", "0:a:0", "-c", "copy", audio)
	broken := filepath.Join(dir, "broken.mp4")
	if err := os.WriteFile(broken, []byte("truncated invalid media"), 0600); err != nil {
		t.Fatal(err)
	}
	s := New(config.VideoDownloaderConfig{FFmpegCommand: ffmpeg, FFprobeCommand: ffprobe})
	for _, tc := range []struct {
		name     string
		inputs   []string
		audio    bool
		duration float64
		bad      bool
	}{
		{"multipart", []string{source, source}, false, 2, false},
		{"separate-audio", []string{video, audio}, true, 1, false},
		{"broken-second-part", []string{source, broken}, false, 0, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			target := filepath.Join(dir, tc.name+".mp4")
			err := s.finish(ctx, tc.inputs, tc.audio, "compat", dir, target)
			if tc.bad {
				if err == nil {
					t.Fatal("corrupt second part was treated as a successful complete video")
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			out, stderr, err := runCommand(ctx, ffprobe, []string{"-v", "error", "-show_entries", "stream=codec_type:format=duration", "-of", "json", target}, dir, 10<<20)
			if err != nil {
				t.Fatalf("probe failed: %v %s", err, stderr)
			}
			metadata, err := decodeJSON(bytes.NewReader(out))
			if err != nil {
				t.Fatal(err)
			}
			duration := number(child(metadata, "format"), "duration")
			if duration < tc.duration-0.1 || duration > tc.duration+0.2 || !strings.Contains(string(out), `"codec_type": "video"`) || !strings.Contains(string(out), `"codec_type": "audio"`) {
				t.Fatalf("lost media or wrong duration: %s", out)
			}
		})
	}
}

// Opt-in network check; ordinary tests never depend on platform availability.
func TestPublicVideoSmoke(t *testing.T) {
	source := os.Getenv("VIDEO_DOWNLOAD_SMOKE_URL")
	if source == "" {
		t.Skip("set VIDEO_DOWNLOAD_SMOKE_URL to check a public video")
	}
	if endpoint := os.Getenv("VIDEO_DOWNLOAD_SMOKE_DOH"); endpoint != "" {
		useSmokeDNS(t, endpoint)
	}
	s := New(config.VideoDownloaderConfig{Enabled: true, TempDir: t.TempDir(), ResolveTimeout: 90 * time.Second})
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()
	m, err := s.Resolve(ctx, source, "speed")
	if err != nil {
		t.Fatal(err)
	}
	t.Logf("platform=%s duration=%ds resolution=%dx%d estimate=%d", m.Platform, m.DurationSeconds, m.Width, m.Height, m.EstimatedBytes)
	if os.Getenv("VIDEO_DOWNLOAD_SMOKE_FILE") != "1" {
		return
	}
	f, err := s.Download(ctx, source, "speed")
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	written, err := io.Copy(io.Discard, f)
	if err != nil || written != f.Size || written <= 0 {
		t.Fatalf("attachment size=%d expected=%d err=%v", written, f.Size, err)
	}
	t.Logf("validated MP4 attachment: %d bytes", written)
}

// Only for opt-in network tests on developer machines with fake-IP DNS.
// Real answers still pass the production public-address checks unchanged.
func useSmokeDNS(t *testing.T, endpoint string) {
	t.Helper()
	previous := net.DefaultResolver
	client := &http.Client{Timeout: 15 * time.Second, Transport: &http.Transport{}}
	net.DefaultResolver = &net.Resolver{PreferGo: true, Dial: func(ctx context.Context, _, _ string) (net.Conn, error) {
		local, remote := net.Pipe()
		go func() {
			defer remote.Close()
			var header [2]byte
			if _, err := io.ReadFull(remote, header[:]); err != nil {
				return
			}
			query := make([]byte, binary.BigEndian.Uint16(header[:]))
			if _, err := io.ReadFull(remote, query); err != nil {
				return
			}
			req, err := http.NewRequestWithContext(ctx, "POST", endpoint, bytes.NewReader(query))
			if err != nil {
				return
			}
			req.Header.Set("Content-Type", "application/dns-message")
			resp, err := client.Do(req)
			if err != nil {
				return
			}
			defer resp.Body.Close()
			answer, err := io.ReadAll(io.LimitReader(resp.Body, 65536))
			if err != nil || resp.StatusCode != 200 || len(answer) > 65535 {
				return
			}
			binary.BigEndian.PutUint16(header[:], uint16(len(answer)))
			_, _ = remote.Write(append(header[:], answer...))
		}()
		return local, nil
	}}
	t.Cleanup(func() { net.DefaultResolver = previous; client.CloseIdleConnections() })
}
