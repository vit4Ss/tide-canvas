package social

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"net/http"
	"time"

	"tidecanvas/internal/config"
	"tidecanvas/internal/pkg/videodownload"
)

type localVideoDownloader struct{ engine *videodownload.Service }

func newLocalVideoDownloader(cfg config.VideoDownloaderConfig, fallback ...videodownload.DouyinResolver) *localVideoDownloader {
	var resolve videodownload.DouyinResolver
	if len(fallback) > 0 {
		resolve = fallback[0]
	}
	return &localVideoDownloader{engine: videodownload.NewWithDouyinFallback(cfg, resolve)}
}
func (d *localVideoDownloader) platforms(context.Context) (downloaderCapabilitiesVO, error) {
	ready := d.engine.Ready()
	platforms := []string{}
	if ready {
		platforms = append(platforms, videodownload.Platforms...)
	}
	return downloaderCapabilitiesVO{Enabled: ready, Platforms: platforms, MaxFileBytes: d.engine.MaxBytes(), TokenTTLSeconds: int(videoDownloadTicketMax / time.Second)}, nil
}
func localDownloadError(err error) error {
	if err == nil {
		return nil
	}
	var problem *videodownload.Error
	if errors.As(err, &problem) {
		return &videoDownloaderError{status: problem.Status, message: problem.Message, authored: true}
	}
	return &videoDownloaderError{status: 503, message: "视频下载服务暂时不可用，请稍后重试", authored: true}
}
func (d *localVideoDownloader) resolve(ctx context.Context, source, quality string) (videoDownloadResolveVO, error) {
	m, err := d.engine.Resolve(ctx, source, quality)
	if err != nil {
		return videoDownloadResolveVO{}, localDownloadError(err)
	}
	id := make([]byte, 24)
	if _, err = rand.Read(id); err != nil {
		return videoDownloadResolveVO{}, err
	}
	return videoDownloadResolveVO{ID: "local-" + hex.EncodeToString(id), Platform: m.Platform, Title: truncateText(m.Title, 200), CoverURL: displayImageURL(m.CoverURL), DurationSeconds: m.DurationSeconds, Width: m.Width, Height: m.Height, EstimatedBytes: m.EstimatedBytes, Quality: quality, ExpiresAt: time.Now().Add(videoDownloadTicketMax).Unix()}, nil
}
func (d *localVideoDownloader) download(ctx context.Context, source, quality string) (*http.Response, error) {
	f, err := d.engine.Download(ctx, source, quality)
	if err != nil {
		return nil, localDownloadError(err)
	}
	return &http.Response{StatusCode: http.StatusOK, Header: http.Header{"Content-Type": []string{"video/mp4"}}, ContentLength: f.Size, Body: f}, nil
}
