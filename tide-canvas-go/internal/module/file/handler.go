package file

import (
	"io"
	"mime/multipart"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/tidecanvas/tide-canvas-go/internal/middleware"
	"github.com/tidecanvas/tide-canvas-go/pkg/ecode"
	appjwt "github.com/tidecanvas/tide-canvas-go/pkg/jwt"
	"github.com/tidecanvas/tide-canvas-go/pkg/response"
)

// maxDownloadBytes 代理下载内容上限（对齐 MAX_DOWNLOAD_BYTES = 200MB）。
const maxDownloadBytes = int64(200) * 1024 * 1024

// Handler 文件 HTTP 层（对齐 FileController）。
type Handler struct {
	svc *Service
	jwt *appjwt.Provider
}

// NewHandler 构造。
func NewHandler(svc *Service, jwtProvider *appjwt.Provider) *Handler {
	return &Handler{svc: svc, jwt: jwtProvider}
}

// RegisterRoutes 注册文件路由到给定父组（传入 /api 组 → 实际为 /api/files/*）。
// 全部接口需登录（对齐旧 FileController 受 SecurityUtils.getCurrentUserId 约束）。
//
// 路由清单（前缀 /api/files，对齐 @RequestMapping("/api/files")）：
//
//	POST   /api/files/upload         单文件上传
//	POST   /api/files/upload/batch   批量上传
//	POST   /api/files/presign        申请前端直传凭据
//	POST   /api/files/register       直传完成后登记
//	POST   /api/files/save-from-url  从 URL 保存为素材
//	GET    /api/files/download       服务端代理下载
//	GET    /api/files                文件列表
//	GET    /api/files/:id            文件详情（:id = public_id）
//	DELETE /api/files/:id            删除文件（:id = public_id）
//
// 注：旧版 RateLimit(file_upload/file_presign) 速率限制待限流中间件迁移后补挂。
func (h *Handler) RegisterRoutes(api gin.IRouter, jwtProvider *appjwt.Provider) {
	g := api.Group("/files")
	g.Use(middleware.JWTAuth(jwtProvider))

	g.POST("/upload", middleware.RateLimit(middleware.RateLimitOptions{
		Name: "file_upload", Limit: 30, Period: 60 * time.Second, Dimension: middleware.DimUser, BanThreshold: 0,
	}), h.upload)
	g.POST("/upload/batch", middleware.RateLimit(middleware.RateLimitOptions{
		Name: "file_upload", Limit: 30, Period: 60 * time.Second, Dimension: middleware.DimUser, BanThreshold: 0,
	}), h.uploadBatch)
	g.POST("/presign", h.presign)
	g.POST("/register", h.register)
	g.POST("/save-from-url", h.saveFromURL)
	g.GET("/download", h.download)
	g.GET("", h.list)
	g.GET("/:id", h.get)
	g.DELETE("/:id", h.delete)
}

func (h *Handler) upload(c *gin.Context) {
	fh, err := c.FormFile("file")
	if err != nil {
		response.Fail(c, ecode.BadRequest)
		return
	}
	data, err := readMultipart(fh)
	if err != nil {
		response.Fail(c, ecode.BadRequest)
		return
	}
	vo, err := h.svc.Upload(middleware.MustUserID(c), data, fh.Filename, fh.Header.Get("Content-Type"))
	if err != nil {
		response.FailErr(c, err)
		return
	}
	response.OK(c, vo)
}

func (h *Handler) uploadBatch(c *gin.Context) {
	form, err := c.MultipartForm()
	if err != nil {
		response.Fail(c, ecode.BadRequest)
		return
	}
	fhs := form.File["files"]
	items := make([]UploadItem, 0, len(fhs))
	for _, fh := range fhs {
		data, err := readMultipart(fh)
		if err != nil {
			response.Fail(c, ecode.BadRequest)
			return
		}
		items = append(items, UploadItem{Data: data, OriginalName: fh.Filename, MimeType: fh.Header.Get("Content-Type")})
	}
	vos, err := h.svc.UploadBatch(middleware.MustUserID(c), items)
	if err != nil {
		response.FailErr(c, err)
		return
	}
	response.OK(c, vos)
}

func (h *Handler) presign(c *gin.Context) {
	var req PresignReq
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Fail(c, ecode.BadRequest)
		return
	}
	vo, err := h.svc.Presign(middleware.MustUserID(c), &req)
	if err != nil {
		response.FailErr(c, err)
		return
	}
	response.OK(c, vo)
}

func (h *Handler) register(c *gin.Context) {
	var req RegisterReq
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Fail(c, ecode.BadRequest)
		return
	}
	vo, err := h.svc.Register(middleware.MustUserID(c), &req)
	if err != nil {
		response.FailErr(c, err)
		return
	}
	response.OK(c, vo)
}

func (h *Handler) saveFromURL(c *gin.Context) {
	var req SaveFromURLReq
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Fail(c, ecode.BadRequest)
		return
	}
	vo, err := h.svc.SaveFromURL(middleware.MustUserID(c), req.URL, req.FileType, req.OriginalName)
	if err != nil {
		response.FailErr(c, err)
		return
	}
	response.OK(c, vo)
}

func (h *Handler) list(c *gin.Context) {
	var q ListQuery
	if err := c.ShouldBindQuery(&q); err != nil {
		response.Fail(c, ecode.BadRequest)
		return
	}
	vos, total, err := h.svc.ListFiles(middleware.MustUserID(c), &q)
	if err != nil {
		response.FailErr(c, err)
		return
	}
	response.OK(c, response.Page(vos, total, q.PageNum, q.PageSize))
}

func (h *Handler) get(c *gin.Context) {
	vo, err := h.svc.GetFile(middleware.MustUserID(c), c.Param("id"))
	if err != nil {
		response.FailErr(c, err)
		return
	}
	response.OK(c, vo)
}

func (h *Handler) delete(c *gin.Context) {
	if err := h.svc.DeleteFile(middleware.MustUserID(c), c.Param("id")); err != nil {
		response.FailErr(c, err)
		return
	}
	response.OK(c, nil)
}

// download 服务端代理下载（对齐 FileController.download）：防 SSRF 校验 → 拉取（限流 200MB）→ 以附件返回。
// 错误以 HTTP 状态码表达（与旧版一致：403 不安全 / 413 过大 / 502 上游失败）。
func (h *Handler) download(c *gin.Context) {
	rawURL := c.Query("url")
	if err := assertPublicHTTP(rawURL); err != nil {
		c.Status(http.StatusForbidden)
		return
	}
	body, err := fetchDownloadBody(rawURL)
	if err != nil {
		if err == errDownloadTooLarge {
			c.Status(http.StatusRequestEntityTooLarge)
			return
		}
		c.Status(http.StatusBadGateway)
		return
	}
	name := c.Query("name")
	if strings.TrimSpace(name) == "" {
		name = "image"
	}
	filename := name + ".png"
	c.Header("Content-Type", "application/octet-stream")
	c.Header("Content-Disposition",
		"attachment; filename*=UTF-8''"+strings.ReplaceAll(url.QueryEscape(filename), "+", "%20"))
	c.Data(http.StatusOK, "application/octet-stream", body)
}

// errDownloadTooLarge 下载内容超限。
var errDownloadTooLarge = ecode.BadRequest.WithMessage("download too large")

// fetchDownloadBody 拉取下载内容，不跟随重定向、超时控制、累计字节超限即中止（对齐 fetchDownloadBody）。
func fetchDownloadBody(rawURL string) ([]byte, error) {
	client := &http.Client{
		Timeout: 60 * time.Second,
		CheckRedirect: func(*http.Request, []*http.Request) error {
			return http.ErrUseLastResponse // 不跟随重定向
		},
	}
	resp, err := client.Get(rawURL)
	if err != nil {
		return nil, err
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode >= 400 {
		return nil, ecode.ServerError.WithMessage("upstream error")
	}
	limited := io.LimitReader(resp.Body, maxDownloadBytes+1)
	body, err := io.ReadAll(limited)
	if err != nil {
		return nil, err
	}
	if int64(len(body)) > maxDownloadBytes {
		return nil, errDownloadTooLarge
	}
	return body, nil
}

// assertPublicHTTP 防 SSRF：仅允许 http/https 公网地址，拒绝内网/环回/链路本地(含云元数据)/CGNAT/IPv6 ULA
// （对齐 SafeUrl.assertPublicHttp）。
func assertPublicHTTP(rawURL string) error {
	if strings.TrimSpace(rawURL) == "" {
		return ecode.BadRequest.WithMessage("非法地址")
	}
	u, err := url.Parse(rawURL)
	if err != nil {
		return ecode.BadRequest.WithMessage("非法地址")
	}
	scheme := strings.ToLower(u.Scheme)
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

// isBlockedIP 判定是否为应拒绝的地址（对齐 SafeUrl.isBlocked）。
func isBlockedIP(ip net.IP) bool {
	if ip.IsLoopback() || ip.IsUnspecified() || ip.IsLinkLocalUnicast() ||
		ip.IsLinkLocalMulticast() || ip.IsMulticast() || ip.IsPrivate() {
		return true
	}
	if v4 := ip.To4(); v4 != nil {
		// 100.64.0.0/10 运营商级 NAT(CGNAT)
		if v4[0] == 100 && v4[1] >= 64 && v4[1] <= 127 {
			return true
		}
	}
	// IPv6 ULA fc00::/7
	if v16 := ip.To16(); v16 != nil && ip.To4() == nil {
		return v16[0]&0xfe == 0xfc
	}
	return false
}

// readMultipart 读取上传文件全部字节。
func readMultipart(fh *multipart.FileHeader) ([]byte, error) {
	f, err := fh.Open()
	if err != nil {
		return nil, err
	}
	defer func() { _ = f.Close() }()
	return io.ReadAll(f)
}
