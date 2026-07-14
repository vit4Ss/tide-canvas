// Command stylecovers fills style_preset.cover_url for system styles that lack a
// cover: it generates one image per style via the relay (text_to_image, the
// style's own prompt), uploads it to the configured storage (OSS, keys read from
// sys_config like the server does), and writes the stable URL back. Idempotent —
// only styles with an empty cover_url are touched; pass -apply to actually
// generate/upload/update (default is a dry-run listing).
package main

import (
	"bytes"
	"context"
	"flag"
	"fmt"
	"io"
	"log"
	"net/http"
	"path"
	"strings"
	"sync"
	"time"

	gmysql "gorm.io/driver/mysql"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"

	"tidecanvas/internal/config"
	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/relaymedia"
	"tidecanvas/internal/pkg/storage"
)

// coverSubject keeps one neutral subject across all covers so the差异 between
// cards reads as“风格不同”而不是“内容不同”。
const coverSubject = "A young woman standing on a quiet street at golden hour, medium shot"

func main() {
	apply := flag.Bool("apply", false, "generate covers, upload to storage and update cover_url")
	imgModel := flag.String("model", "gpt-image-2", "relay image model id")
	flag.Parse()

	cfg, err := config.Load()
	if err != nil {
		log.Fatal(err)
	}
	fmt.Println("env:", cfg.Env, " mysql:", cfg.MySQL.Host, "/", cfg.MySQL.Database)

	gdb, err := gorm.Open(gmysql.Open(cfg.MySQL.BuildDSN()), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		log.Fatal(err)
	}

	var rows []model.StylePreset
	if err := gdb.Where("owner_type = 'system' AND (cover_url IS NULL OR cover_url = '')").
		Order("sort_order ASC").Find(&rows).Error; err != nil {
		log.Fatal(err)
	}
	if len(rows) == 0 {
		fmt.Println("all system styles already have covers — nothing to do")
		return
	}
	fmt.Printf("%d system styles without cover:\n", len(rows))
	for i := range rows {
		fmt.Printf("  - %s (%s)\n", rows[i].Name, rows[i].Category)
	}
	if !*apply {
		fmt.Println("(dry run — pass -apply to generate & upload)")
		return
	}

	effStorage, err := storage.SeedAndLoadConfig(gdb, cfg.Storage)
	if err != nil {
		log.Fatal("load storage config:", err)
	}
	store, err := storage.New(effStorage)
	if err != nil {
		log.Fatal("init storage:", err)
	}
	relay := relaymedia.New(cfg.Relay.BaseURL, cfg.Relay.APIKey)
	if relay == nil {
		log.Fatal("relay apiKey is not configured")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Minute)
	defer cancel()

	// 并发 2:relay 对 gpt-image-2 有「最多同时 5 个」的硬上限,还要给真实用户留槽位
	sem := make(chan struct{}, 2)
	var wg sync.WaitGroup
	for i := range rows {
		wg.Add(1)
		go func(row *model.StylePreset) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()
			if err := fillCover(ctx, gdb, relay, store, *imgModel, row); err != nil {
				log.Printf("FAIL %s: %v", row.Name, err)
				return
			}
			fmt.Printf("OK   %s -> cover updated\n", row.Name)
		}(&rows[i])
	}
	wg.Wait()
}

// fillCover generates, uploads and persists one style cover.
func fillCover(ctx context.Context, gdb *gorm.DB, relay *relaymedia.Client, store storage.StorageStrategy, imgModel string, row *model.StylePreset) error {
	prompt := fmt.Sprintf("%s. Style: %s", coverSubject, row.Prompt)
	// 画幅必须取自模型 params_schema.aspect(gpt-image-2: 1:1/9:16/16:9/3:2/2:3/1:8/3:1);
	// 传不支持的值(如 3:4)上游会挂起直到 6 分钟超时
	params := relaymedia.ImageParams{Model: imgModel, Prompt: prompt, Quality: "medium", AspectRatio: "2:3"}
	var res relaymedia.Result
	var err error
	for attempt := 1; attempt <= 5; attempt++ {
		res, err = relay.GenerateImage(ctx, params)
		if err == nil {
			break
		}
		// 超并发/超时都是暂时态:等一分钟让 relay 槽位腾出来再试
		if strings.Contains(err.Error(), "超并发") || strings.Contains(err.Error(), "deadline") {
			log.Printf("retry %s (attempt %d): %v", row.Name, attempt, err)
			select {
			case <-ctx.Done():
				return ctx.Err()
			case <-time.After(time.Minute):
			}
			continue
		}
		return fmt.Errorf("generate: %w", err)
	}
	if err != nil {
		return fmt.Errorf("generate: %w", err)
	}
	if len(res.URLs) == 0 {
		return fmt.Errorf("generate returned no url")
	}

	data, ct, err := download(ctx, res.URLs[0])
	if err != nil {
		return fmt.Errorf("download: %w", err)
	}
	key := fmt.Sprintf("covers/style/%d%s", row.ID, extFor(res.URLs[0], ct))
	url, err := store.Save(ctx, key, bytes.NewReader(data), ct)
	if err != nil {
		return fmt.Errorf("upload: %w", err)
	}
	if err := gdb.Model(&model.StylePreset{}).Where("id = ?", row.ID).
		Update("cover_url", url).Error; err != nil {
		return fmt.Errorf("update db: %w", err)
	}
	return nil
}

func download(ctx context.Context, url string) ([]byte, string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, "", err
	}
	resp, err := (&http.Client{Timeout: 90 * time.Second}).Do(req)
	if err != nil {
		return nil, "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, "", fmt.Errorf("HTTP %d", resp.StatusCode)
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, 64<<20))
	if err != nil {
		return nil, "", err
	}
	return data, strings.TrimSpace(resp.Header.Get("Content-Type")), nil
}

func extFor(url, contentType string) string {
	if i := strings.Index(url, "?"); i >= 0 {
		url = url[:i]
	}
	if e := strings.ToLower(path.Ext(url)); e != "" && len(e) <= 5 {
		return e
	}
	switch {
	case strings.Contains(contentType, "jpeg"):
		return ".jpg"
	case strings.Contains(contentType, "webp"):
		return ".webp"
	}
	return ".png"
}
