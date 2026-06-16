package ai

import (
	"bytes"
	"fmt"
	"image"
	"image/jpeg"
	"image/png"
	"io"
	"net"
	"net/http"
	"net/url"
	"time"

	"github.com/tidecanvas/tide-canvas-go/pkg/ecode"
)

// GridStorage 宫格切片上传抽象（对齐 ImageGridServiceImpl 注入的 StorageStrategy.uploadBytes + getAccessUrl）。
// 由 router 注入 file 模块存储实现；上传字节并返回可公网访问的地址。
// directory 约定为 "grid"。
type GridStorage interface {
	// UploadBytes 上传字节内容到 directory 子目录，返回公网访问地址。
	UploadBytes(data []byte, fileName, contentType, directory string) (string, error)
}

// gridLimits 源图大小/像素上限（对齐 ImageGridServiceImpl 常量）。
const (
	maxGridSourceBytes = 50 * 1024 * 1024 // 50MB
	maxGridPixels      = 36_000_000       // 3600 万像素
)

// gridHTTPClient 源图下载客户端：禁用重定向、连接超时 15s、整体超时 30s（对齐 ImageGridServiceImpl）。
var gridHTTPClient = &http.Client{
	Timeout: 30 * time.Second,
	CheckRedirect: func(req *http.Request, via []*http.Request) error {
		return http.ErrUseLastResponse // 不跟随重定向（对齐 Redirect.NEVER）
	},
}

// GridSplit 图片宫格切分：将 imageUrl 指向的图片均匀切成 rows×cols 块，按需仅切 cells 指定格子，
// 每块编码为 PNG 上传后返回访问地址列表（对齐 ImageGridServiceImpl.split）。
//
// webp 解码暂未支持（TODO: 引 golang.org/x/image/webp 注册解码器后即可，stdlib image 不含 webp）。
func (s *Service) GridSplit(storage GridStorage, dto *GridSplitDTO) ([]string, error) {
	if storage == nil {
		return nil, ecode.ServerError.WithMessage("宫格切分未配置存储后端")
	}
	rows := dto.Rows
	if rows < 1 {
		rows = 1
	}
	cols := dto.Cols
	if cols < 1 {
		cols = 1
	}
	src, err := downloadImage(dto.ImageURL)
	if err != nil {
		return nil, err
	}
	bounds := src.Bounds()
	w := bounds.Dx()
	h := bounds.Dy()

	// 切分顺序：指定 cells（行优先 0-based，去重、越界过滤）或全部。
	total := rows * cols
	var order []int
	if len(dto.Cells) > 0 {
		seen := make(map[int]struct{}, len(dto.Cells))
		for _, i := range dto.Cells {
			if i < 0 || i >= total {
				continue
			}
			if _, dup := seen[i]; dup {
				continue
			}
			seen[i] = struct{}{}
			order = append(order, i)
		}
	} else {
		order = make([]int, 0, total)
		for i := 0; i < total; i++ {
			order = append(order, i)
		}
	}

	urls := make([]string, 0, len(order))
	for _, idx := range order {
		r := idx / cols
		c := idx % cols
		// 整数比例切分（对齐 Java 的 c*w/cols 写法，避免累积舍入缝隙）。
		x := c * w / cols
		y := r * h / rows
		cw := (c+1)*w/cols - x
		ch := (r+1)*h/rows - y
		tile := cropToRGBA(src, bounds.Min.X+x, bounds.Min.Y+y, cw, ch)
		data, err := encodePNG(tile)
		if err != nil {
			return nil, err
		}
		fileName := fmt.Sprintf("grid_%d.png", idx+1)
		accessURL, err := storage.UploadBytes(data, fileName, "image/png", "grid")
		if err != nil {
			return nil, ecode.ServerError.WithMessage("切片上传失败: " + err.Error())
		}
		urls = append(urls, accessURL)
	}
	if s.logger != nil {
		s.logger.Infof("Grid split completed: rows=%d, cols=%d, tiles=%d, source=%dx%d", rows, cols, len(urls), w, h)
	}
	return urls, nil
}

// downloadImage 下载并解码源图（SSRF 防护 + 大小/像素上限），对齐 ImageGridServiceImpl.download。
func downloadImage(rawURL string) (image.Image, error) {
	if err := assertPublicHTTP(rawURL); err != nil {
		return nil, err
	}
	req, err := http.NewRequest(http.MethodGet, rawURL, nil)
	if err != nil {
		return nil, ecode.BadRequest.WithMessage("非法地址")
	}
	resp, err := gridHTTPClient.Do(req)
	if err != nil {
		return nil, ecode.BadRequest.WithMessage("下载源图失败: " + err.Error())
	}
	defer resp.Body.Close()
	if resp.StatusCode/100 != 2 {
		return nil, ecode.BadRequest.WithMessage(fmt.Sprintf("下载源图失败，HTTP %d", resp.StatusCode))
	}
	// 限制读取字节数，超限报错（对齐 MAX_SOURCE_BYTES）。
	limited := io.LimitReader(resp.Body, maxGridSourceBytes+1)
	body, err := io.ReadAll(limited)
	if err != nil {
		return nil, ecode.BadRequest.WithMessage("下载源图失败: " + err.Error())
	}
	if len(body) > maxGridSourceBytes {
		return nil, ecode.FileSizeExceeded.WithMessage("源图过大")
	}
	img, _, err := image.Decode(bytes.NewReader(body))
	if err != nil {
		// stdlib 默认支持 png/jpeg/gif；webp 等需额外解码器（见函数注释 TODO）。
		return nil, ecode.BadRequest.WithMessage("无法解析图片内容(服务端不支持该图片格式)")
	}
	b := img.Bounds()
	if int64(b.Dx())*int64(b.Dy()) > maxGridPixels {
		return nil, ecode.FileSizeExceeded.WithMessage("源图像素过大")
	}
	return img, nil
}

// cropToRGBA 裁剪子图并复制为独立 RGBA（对齐 toPng 的 drawImage 到新 TYPE_INT_ARGB 画布）。
func cropToRGBA(src image.Image, x, y, w, h int) *image.RGBA {
	dst := image.NewRGBA(image.Rect(0, 0, w, h))
	for dy := 0; dy < h; dy++ {
		for dx := 0; dx < w; dx++ {
			dst.Set(dx, dy, src.At(x+dx, y+dy))
		}
	}
	return dst
}

// encodePNG 编码为 PNG 字节（对齐 ImageIO.write(copy, "png")）。
func encodePNG(img image.Image) ([]byte, error) {
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		return nil, ecode.ServerError.WithMessage("图片编码失败")
	}
	return buf.Bytes(), nil
}

// 引入 jpeg 解码器（image.Decode 需要注册；png 已在上面 import 注册，gif 略）。
var _ = jpeg.Decode

// assertPublicHTTP 防 SSRF 的 URL 校验：仅允许 http/https 公网地址，拒绝环回/内网/链路本地（含云元数据）
// /CGNAT/IPv6 ULA（忠实迁移 SafeUrl.assertPublicHttp）。
func assertPublicHTTP(rawURL string) error {
	u, err := url.Parse(rawURL)
	if err != nil {
		return ecode.BadRequest.WithMessage("非法地址")
	}
	scheme := u.Scheme
	if scheme != "http" && scheme != "https" {
		return ecode.BadRequest.WithMessage("仅允许 http/https 地址")
	}
	host := u.Hostname()
	if host == "" {
		return ecode.BadRequest.WithMessage("非法地址")
	}
	addrs, err := net.LookupIP(host)
	if err != nil || len(addrs) == 0 {
		return ecode.BadRequest.WithMessage("无法解析的地址")
	}
	for _, ip := range addrs {
		if isBlockedIP(ip) {
			return ecode.BadRequest.WithMessage("禁止访问该地址")
		}
	}
	return nil
}

// isBlockedIP 拦截内网/环回/链路本地(含 169.254.169.254)/私网/组播/CGNAT/IPv6 ULA（对齐 SafeUrl.isBlocked）。
func isBlockedIP(ip net.IP) bool {
	if ip.IsLoopback() || ip.IsUnspecified() || ip.IsLinkLocalUnicast() ||
		ip.IsLinkLocalMulticast() || ip.IsPrivate() || ip.IsMulticast() {
		return true
	}
	if v4 := ip.To4(); v4 != nil {
		// 100.64.0.0/10 运营商级 NAT(CGNAT)
		if v4[0] == 100 && v4[1] >= 64 && v4[1] <= 127 {
			return true
		}
		return false
	}
	// IPv6 ULA fc00::/7
	return len(ip) == net.IPv6len && (ip[0]&0xfe) == 0xfc
}
