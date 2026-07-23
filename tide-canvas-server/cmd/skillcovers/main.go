// Command skillcovers fills skill.cover_url for skills that lack a cover: it
// generates one image per skill via the relay (text_to_image, driven by the
// skill's own prompt_template), uploads it to the configured storage (OSS, keys
// read from sys_config like the server does), and writes the stable URL back.
// Idempotent — only skills with an empty cover_url are touched; pass -apply to
// actually generate/upload/update (default is a dry-run listing).
//
// 与 cmd/stylecovers 同源(风格预设封面),差异只有三处:表/主体/画幅。
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

// 封面主体按模态分两种,同模态内保持一致——卡片之间的差异应该读作「技能不同」
// 而不是「画的东西不同」。
//
//	image/video 技能:统一人物中景,差异全部来自技能模板里的风格/布光/运镜
//	audio 技能  :无可拍主体,走唱片封面的路子(场景与氛围,不出现人脸特写)
const (
	subjectVisual = "A young woman standing on a quiet street at golden hour, medium shot"
	subjectAudio  = "An album cover artwork: an evocative empty scene that conveys the mood of the music, no text, no lettering"
)

func subjectFor(outputType string) string {
	if outputType == "audio" {
		return subjectAudio
	}
	return subjectVisual
}

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

	var rows []model.Skill
	if err := gdb.Where("cover_url IS NULL OR cover_url = ''").
		Order("sort_order ASC, id ASC").Find(&rows).Error; err != nil {
		log.Fatal(err)
	}
	if len(rows) == 0 {
		fmt.Println("all skills already have covers — nothing to do")
		return
	}
	fmt.Printf("%d skills without cover:\n", len(rows))
	for i := range rows {
		fmt.Printf("  - %-16s [%s/%s]\n", rows[i].Title, rows[i].OutputType, rows[i].Category)
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
		go func(row *model.Skill) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()
			if err := fillCover(ctx, gdb, relay, store, *imgModel, row); err != nil {
				log.Printf("FAIL %s: %v", row.Title, err)
				return
			}
			fmt.Printf("OK   %s -> cover updated\n", row.Title)
		}(&rows[i])
	}
	wg.Wait()
}

// fillCover generates, uploads and persists one skill cover.
func fillCover(ctx context.Context, gdb *gorm.DB, relay *relaymedia.Client, store storage.StorageStrategy, imgModel string, row *model.Skill) error {
	prompt := fmt.Sprintf("%s. Style: %s", subjectFor(row.OutputType), row.PromptTemplate)
	// 画幅取 3:2:卡片缩略图是 132x92 的横图,3:2 进 object-cover 几乎不裁。
	// 值必须落在模型 params_schema.aspect 内(gpt-image-2: 1:1/9:16/16:9/3:2/2:3/1:8/3:1),
	// 传不支持的值上游会挂起到 6 分钟超时。
	params := relaymedia.ImageParams{Model: imgModel, Prompt: prompt, Quality: "medium", AspectRatio: "3:2"}
	var res relaymedia.Result
	var err error
	for attempt := 1; attempt <= 5; attempt++ {
		res, err = relay.GenerateImage(ctx, params)
		if err == nil {
			break
		}
		// 超并发/超时都是暂时态:等一分钟让 relay 槽位腾出来再试
		if strings.Contains(err.Error(), "超并发") || strings.Contains(err.Error(), "deadline") {
			log.Printf("retry %s (attempt %d): %v", row.Title, attempt, err)
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
	key := fmt.Sprintf("covers/skill/%d%s", row.ID, extFor(res.URLs[0], ct))
	url, err := store.Save(ctx, key, bytes.NewReader(data), ct)
	if err != nil {
		return fmt.Errorf("upload: %w", err)
	}
	if err := gdb.Model(&model.Skill{}).Where("id = ?", row.ID).
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
