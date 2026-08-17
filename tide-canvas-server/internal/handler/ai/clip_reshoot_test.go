package ai

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/idgen"
	"tidecanvas/internal/pkg/storage"
)

type clipReshootTestStorage struct {
	baseURL string
	saved   []byte
}

func TestDecodeClipReshootSpecTreatsTypedNilAsAbsent(t *testing.T) {
	var spec *clipReshootSpec
	decoded, err := decodeClipReshootSpec(spec)
	if err != nil || decoded != nil {
		t.Fatalf("typed nil decoded as %#v, err=%v", decoded, err)
	}
}

func (s *clipReshootTestStorage) Save(_ context.Context, _ string, reader io.Reader, _ string) (string, error) {
	data, err := io.ReadAll(reader)
	if err != nil {
		return "", err
	}
	s.saved = data
	return s.baseURL + "/saved.mp4", nil
}
func (*clipReshootTestStorage) Delete(context.Context, string) error { return nil }
func (s *clipReshootTestStorage) URL(key string) string              { return s.baseURL + "/" + key }
func (*clipReshootTestStorage) Presign(context.Context, string, string, int64) (storage.PresignResult, error) {
	return storage.PresignResult{}, storage.ErrUnsupported
}
func (*clipReshootTestStorage) Stat(context.Context, string) (storage.ObjectMeta, error) {
	return storage.ObjectMeta{}, storage.ErrUnsupported
}
func (*clipReshootTestStorage) Type() string                  { return "test" }
func (*clipReshootTestStorage) UpstreamURL(url string) string { return url }
func (*clipReshootTestStorage) FetchHosts() []string          { return nil }
func (s *clipReshootTestStorage) OwnsURL(url string) (string, bool) {
	return url, strings.HasPrefix(url, s.baseURL+"/")
}
func (*clipReshootTestStorage) PublicRewrites() [][2]string { return nil }

func TestConfirmClipReshootUsesSelectedDuration(t *testing.T) {
	probes := 0
	s := &service{confirmVideoDuration: func(_ context.Context, userID idgen.ID, source string) (string, float64, error) {
		probes++
		if userID != 42 || source != "source-video" {
			t.Fatalf("confirm input = (%s, %q)", userID, source)
		}
		return "canonical-video", 11, nil
	}}
	confirmed, err := s.confirmClipReshoot(context.Background(), 42, []string{"style-video", "source-video"}, map[string]any{
		"sourceUrl": "source-video",
		"ranges":    []any{map[string]any{"start": 4.0, "end": 7.0}},
	})
	if err != nil {
		t.Fatal(err)
	}
	if probes != 1 || confirmed.SourceIndex != 1 || confirmed.Spec.SourceURL != "canonical-video" {
		t.Fatalf("confirmed clip = %#v, probes = %d", confirmed, probes)
	}
	if confirmed.Spec.DurationSeconds != 3 || confirmed.Spec.OutputDuration != 3 {
		t.Fatalf("selected duration = %#v, want exactly 3 seconds", confirmed.Spec)
	}
}

func TestConfirmClipReshootRejectsOutOfBoundsAndOverlap(t *testing.T) {
	s := &service{confirmVideoDuration: func(context.Context, idgen.ID, string) (string, float64, error) {
		return "canonical-video", 11, nil
	}}
	for name, ranges := range map[string][]clipReshootRange{
		"past-end": {{Start: 9, End: 12}},
		"overlap":  {{Start: 1, End: 4}, {Start: 3, End: 5}},
	} {
		t.Run(name, func(t *testing.T) {
			_, err := s.confirmClipReshoot(context.Background(), 42, []string{"source-video"}, clipReshootSpec{
				SourceURL: "source-video",
				Ranges:    ranges,
			})
			if err == nil {
				t.Fatal("expected invalid clip ranges to be rejected")
			}
		})
	}
}

func TestClipReshootProviderDurationUsesSmallestSupportedTier(t *testing.T) {
	m := &model.AiModel{Config: `{"durations":["4s","5s","11s"]}`}
	duration, err := clipReshootProviderDuration(m, 3)
	if err != nil || duration != 4 {
		t.Fatalf("provider duration = (%d, %v), want (4, nil)", duration, err)
	}
	if _, err := clipReshootProviderDuration(m, 12); err == nil {
		t.Fatal("expected selected duration above the model maximum to fail")
	}
}

func TestPrepareReferenceVideoPricingInputNormalizesClipDurationWhenBillingDisabled(t *testing.T) {
	probes := 0
	s := &service{confirmVideoDuration: func(context.Context, idgen.ID, string) (string, float64, error) {
		probes++
		return "canonical-video", 11, nil
	}}
	dto := generateDTO{
		Handler: "reference_to_video",
		Input: json.RawMessage(`{
			"duration":11,
			"videoReferences":["source-video"],
			"clipReshoot":{"sourceUrl":"source-video","ranges":[{"start":4,"end":7}]}
		}`),
	}
	m := &model.AiModel{Type: "video", Config: `{"referenceVideoBillingEnabled":false,"durations":["4s","5s","11s"]}`}
	cost, err := s.prepareReferenceVideoPricingInput(context.Background(), 42, &dto, m)
	if err != nil || cost != 0 {
		t.Fatalf("prepare = (%d, %v), want (0, nil)", cost, err)
	}
	if probes != 1 {
		t.Fatalf("source probes = %d, want 1", probes)
	}
	var input map[string]any
	if err := json.Unmarshal(dto.Input, &input); err != nil {
		t.Fatal(err)
	}
	if durationSeconds(input["duration"]) != 4 {
		t.Fatalf("provider duration = %v, want minimum supported 4 seconds", input["duration"])
	}
	clip, err := decodeClipReshootSpec(input[clipReshootInputKey])
	if err != nil || clip.DurationSeconds != 3 || clip.OutputDuration != 3 || clip.ProviderDuration != 4 {
		t.Fatalf("normalized clip = (%#v, %v)", clip, err)
	}
	refs := inputStrings(input, "videoReferences")
	if len(refs) != 1 || refs[0] != "canonical-video" {
		t.Fatalf("canonical references = %#v", refs)
	}
}

func TestPrepareReferenceVideoPricingInputBillsOnlySelectedPrimaryDuration(t *testing.T) {
	probes := 0
	s := &service{confirmVideoDuration: func(context.Context, idgen.ID, string) (string, float64, error) {
		probes++
		return "canonical-video", 11, nil
	}}
	dto := generateDTO{
		Handler: "reference_to_video",
		Input: json.RawMessage(`{
			"duration":11,"resolution":"720p",
			"videoReferences":["source-video"],
			"clipReshoot":{"sourceUrl":"source-video","ranges":[{"start":4,"end":7}]}
		}`),
	}
	m := &model.AiModel{Type: "video", Config: `{
		"referenceVideoBillingEnabled":true,
		"durations":["4s","11s"],"resolutions":["720p"],
		"priceMatrix":{"4s":{"720p":28},"11s":{"720p":77}}
	}`}
	cost, err := s.prepareReferenceVideoPricingInput(context.Background(), 42, &dto, m)
	if err != nil {
		t.Fatal(err)
	}
	if probes != 1 || cost != 28 {
		t.Fatalf("clip surcharge = %d, probes = %d; want 28 and one probe", cost, probes)
	}
	if base := resolveCost(m, dto.Input); base != 28 {
		t.Fatalf("base cost = %d, want 4-second tier cost 28", base)
	}
}

func TestBuildClipReshootFilterConcatenatesRangesInOrder(t *testing.T) {
	filter, video, audio := buildClipReshootFilter([]clipReshootRange{{Start: 1, End: 2}, {Start: 4, End: 6}}, true)
	if video != "[clipv]" || audio != "[clipa]" {
		t.Fatalf("outputs = (%q, %q)", video, audio)
	}
	for _, expected := range []string{
		"[0:v:0]trim=start=1.000:end=2.000",
		"[0:a:0]atrim=start=4.000:end=6.000",
		"[v0][a0][v1][a1]concat=n=2:v=1:a=1[clipv][clipa]",
	} {
		if !strings.Contains(filter, expected) {
			t.Fatalf("filter %q does not contain %q", filter, expected)
		}
	}
}

func TestRenderClipReshootReferenceProducesOnlySelectedThreeSeconds(t *testing.T) {
	ffmpeg, err := exec.LookPath("ffmpeg")
	if err != nil {
		t.Skip("ffmpeg is not installed")
	}
	ffprobe, err := exec.LookPath("ffprobe")
	if err != nil {
		t.Skip("ffprobe is not installed")
	}
	tempDir := t.TempDir()
	sourcePath := filepath.Join(tempDir, "source.mp4")
	makeCtx, cancelMake := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancelMake()
	makeVideo := exec.CommandContext(makeCtx, ffmpeg,
		"-hide_banner", "-loglevel", "error", "-y",
		"-f", "lavfi", "-i", "testsrc=size=160x90:rate=12:duration=11",
		"-f", "lavfi", "-i", "sine=frequency=440:sample_rate=44100:duration=11",
		"-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p",
		"-c:a", "aac", "-shortest", sourcePath,
	)
	if output, err := makeVideo.CombinedOutput(); err != nil {
		t.Fatalf("create source video: %v (%s)", err, output)
	}
	sourceFile, err := os.Open(sourcePath)
	if err != nil {
		t.Fatal(err)
	}
	defer sourceFile.Close()
	info, err := sourceFile.Stat()
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		http.ServeContent(writer, request, "source.mp4", info.ModTime(), sourceFile)
	}))
	defer server.Close()
	store := &clipReshootTestStorage{baseURL: server.URL}
	s := &service{storage: store}
	clipURL, err := s.renderClipReshootReference(context.Background(), 42, clipReshootSpec{
		SourceURL: server.URL + "/source.mp4",
		Ranges:    []clipReshootRange{{Start: 4, End: 7}},
	})
	if err != nil {
		t.Fatal(err)
	}
	if clipURL != server.URL+"/saved.mp4" || len(store.saved) == 0 {
		t.Fatalf("saved clip = (%q, %d bytes)", clipURL, len(store.saved))
	}
	outputPath := filepath.Join(tempDir, "selected.mp4")
	if err := os.WriteFile(outputPath, store.saved, 0o600); err != nil {
		t.Fatal(err)
	}
	probeCtx, cancelProbe := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancelProbe()
	probe := exec.CommandContext(probeCtx, ffprobe,
		"-v", "error", "-show_entries", "format=duration",
		"-of", "default=noprint_wrappers=1:nokey=1", outputPath,
	)
	rawDuration, err := probe.Output()
	if err != nil {
		t.Fatal(err)
	}
	duration, err := strconv.ParseFloat(strings.TrimSpace(string(rawDuration)), 64)
	if err != nil {
		t.Fatal(err)
	}
	if duration < 2.95 || duration > 3.1 {
		t.Fatalf("rendered clip duration = %.3f seconds, want 3 seconds", duration)
	}
}
