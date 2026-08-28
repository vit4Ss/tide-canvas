package file

// asset_size.go: 已存资产的字节大小查询。
//
// 生成结果直接写进对象存储（provider_relay.saveRemote 的 gen/ 前缀），没有
// files 行，因此前端从资产库选取「生成历史」里的图片时拿不到 sizeBytes；
// 而 3D 生成必须按模型配置卡单图大小，未知大小只能拒绝——用户看到的就是
// 「无法确认该素材的文件大小」。这个接口让前端把大小补齐：只对本站存储自己
// 的对象做 Stat（OwnsURL 同一套归属判定），不抓任意外链，不引入 SSRF 面。

import (
	"strings"

	"github.com/gin-gonic/gin"

	"tidecanvas/internal/pkg/response"
	"tidecanvas/internal/pkg/storage"
)

// AssetSizeVO is the byte size of an owned storage object.
type AssetSizeVO struct {
	SizeBytes int64 `json:"sizeBytes"`
}

// assetSize GET /api/files/asset-size?url=... -> AssetSizeVO
func (h *handler) assetSize(c *gin.Context) {
	rawURL := strings.TrimSpace(c.Query("url"))
	if rawURL == "" {
		response.Fail(c, response.CodeBadRequest, "missing url")
		return
	}
	statter, ok := h.svc.store.(storage.OwnedURLStatter)
	if !ok {
		response.Fail(c, response.CodeBadRequest, "storage does not expose object size")
		return
	}
	meta, err := statter.StatURL(c.Request.Context(), rawURL)
	if err != nil || meta.Size <= 0 {
		// 非本站对象、对象已删除、存储侧异常都归到同一句：调用方只需要知道
		// 「查不到大小」，让用户改走本地上传，不必区分原因。
		response.Fail(c, response.CodeNotFound, "asset size is unavailable")
		return
	}
	response.OK(c, AssetSizeVO{SizeBytes: meta.Size})
}
