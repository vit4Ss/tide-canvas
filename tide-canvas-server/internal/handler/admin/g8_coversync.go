package admin

// g8_coversync.go: 第三方外链封面转存——把作品/灵感模块里仍是外部链接的
// 封面下载回服务器,经 OSS 传输加速域名上传进桶(storage 分层:PutObject 走
// 加速域名),再把记录里的 URL 改写为当前 publicBase(CDN)地址。转存后这些
// 资源只依赖本站存储,不再受第三方图床可用性/稳定性影响。
//
// 已是本站 URL(FetchHosts 命中)的记录跳过,天然幂等;第三方下载失败的
// 记录跳过并汇总原因,不阻断其余。

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"

	"tidecanvas/internal/app"
	"tidecanvas/internal/pkg/idgen"
	"tidecanvas/internal/pkg/response"
	"tidecanvas/internal/pkg/storage"
)

const (
	coverFetchTimeout = 15 * time.Second
	coverMaxBytes     = 20 << 20 // 单张上限 20MB
	coverMaxFailures  = 20       // 失败原因列表截断
)

var coverHTTP = &http.Client{Timeout: coverFetchTimeout}

// coverSyncResult 是一次同步的汇总。
type coverSyncResult struct {
	Scanned int      `json:"scanned"`
	Synced  int      `json:"synced"`
	Failed  []string `json:"failed"`
}

// RegisterCoverSync mounts the 转存 endpoints:
//
//	POST /works/sync-covers        -> coverSyncResult(community_post.cover_url)
//	POST /inspiration/sync-covers  -> coverSyncResult(collection/prompt_lib.cover_url)
func RegisterCoverSync(worksG, inspG *gin.RouterGroup, d *app.Deps) {
	worksG.POST("/works/sync-covers", func(c *gin.Context) {
		response.OK(c, syncCoverTables(c.Request.Context(), d, []coverTable{
			{"community_post", "cover_url"},
		}))
	})
	inspG.POST("/inspiration/sync-covers", func(c *gin.Context) {
		response.OK(c, syncCoverTables(c.Request.Context(), d, []coverTable{
			{"collection", "cover_url"},
			{"prompt_lib", "cover_url"},
		}))
	})
}

// coverTable 指定要转存的表与 URL 列(id 一律取主键 id)。
type coverTable struct {
	table string
	url   string
}

// syncCoverTables 对一组表逐张执行外链转存并汇总。
func syncCoverTables(ctx context.Context, d *app.Deps, tables []coverTable) coverSyncResult {
	var out coverSyncResult
	if d.Storage == nil {
		out.Failed = append(out.Failed, "存储未初始化")
		return out
	}
	ownHosts := d.Storage.FetchHosts()
	for _, t := range tables {
		r := syncOneTable(ctx, d.DB, d.Storage, ownHosts, t)
		out.Scanned += r.Scanned
		out.Synced += r.Synced
		out.Failed = append(out.Failed, r.Failed...)
	}
	if len(out.Failed) > coverMaxFailures {
		out.Failed = append(out.Failed[:coverMaxFailures], fmt.Sprintf("…共 %d 条失败", len(out.Failed)))
	}
	return out
}

// syncOneTable 把 table.url 列里「http(s) 且不在本站 host 白名单」的记录逐条
// 下载转存并改写为新 URL。
func syncOneTable(ctx context.Context, db *gorm.DB, store storage.StorageStrategy, ownHosts []string, t coverTable) coverSyncResult {
	var out coverSyncResult
	var rows []struct {
		ID  idgen.ID `gorm:"column:id"`
		URL string   `gorm:"column:url"`
	}
	// 表名/列名来自服务端常量(非用户输入),不会注入。
	if err := db.Table(t.table).
		Select("id, " + t.url + " AS url").
		Where(t.url + " LIKE 'http%'").
		Find(&rows).Error; err != nil {
		out.Failed = append(out.Failed, t.table+": 查询失败")
		return out
	}
	for _, row := range rows {
		u := strings.TrimSpace(row.URL)
		if u == "" || onAnyHost(u, ownHosts) {
			continue // 空链或已是本站资源
		}
		out.Scanned++
		newURL, err := rehostCover(ctx, store, t.table, row.ID, u)
		if err != nil {
			out.Failed = append(out.Failed, fmt.Sprintf("%s#%s: %v", t.table, row.ID, err))
			continue
		}
		if err := db.Table(t.table).Where("id = ?", row.ID).Update(t.url, newURL).Error; err != nil {
			out.Failed = append(out.Failed, fmt.Sprintf("%s#%s: 写回失败", t.table, row.ID))
			continue
		}
		out.Synced++
	}
	return out
}

// rehostCover 下载第三方图片并经存储策略(加速域名)上传,返回本站公开 URL。
func rehostCover(ctx context.Context, store storage.StorageStrategy, table string, id idgen.ID, url string) (string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return "", err
	}
	resp, err := coverHTTP.Do(req)
	if err != nil {
		return "", fmt.Errorf("下载失败")
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("下载返回 %d", resp.StatusCode)
	}
	ct := resp.Header.Get("Content-Type")
	if ct == "" || !strings.HasPrefix(ct, "image/") {
		return "", fmt.Errorf("内容不是图片(%s)", ct)
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, coverMaxBytes+1))
	if err != nil {
		return "", fmt.Errorf("读取失败")
	}
	if len(body) > coverMaxBytes {
		return "", fmt.Errorf("超过 %dMB 上限", coverMaxBytes>>20)
	}
	key := fmt.Sprintf("sync/%s/%s-%s%s", table, id, idgen.Next().String(), extOf(ct, url))
	if _, err := store.Save(ctx, key, bytes.NewReader(body), ct); err != nil {
		return "", fmt.Errorf("转存失败")
	}
	return store.URL(key), nil
}

// extOf 按 Content-Type 取扩展名,取不到时从 URL 猜,再不行用 .img。
func extOf(ct, url string) string {
	switch strings.ToLower(strings.Split(ct, ";")[0]) {
	case "image/jpeg":
		return ".jpg"
	case "image/png":
		return ".png"
	case "image/webp":
		return ".webp"
	case "image/gif":
		return ".gif"
	}
	if i := strings.LastIndex(url, "."); i > 0 && len(url)-i <= 5 && !strings.ContainsAny(url[i:], "/?#") {
		return strings.ToLower(url[i:])
	}
	return ".img"
}
