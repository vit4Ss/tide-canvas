package im

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
	"github.com/sirupsen/logrus"

	appjwt "github.com/tidecanvas/tide-canvas-go/pkg/jwt"
)

// InboundHandler 处理客户端经 WebSocket 上行的消息（由 service 实现）。
type InboundHandler interface {
	HandleInbound(userID int64, raw []byte)
}

// WSHandler WebSocket 接入处理器：握手鉴权、升级连接、挂接读写泵。
type WSHandler struct {
	hub      *Hub
	inbound  InboundHandler
	jwt      *appjwt.Provider
	logger   *logrus.Logger
	upgrader websocket.Upgrader
}

// NewWSHandler 构造。allowedOrigins 为允许建立 WebSocket 的来源白名单（取 cors.allowed_origins）。
func NewWSHandler(hub *Hub, inbound InboundHandler, jwtProvider *appjwt.Provider, logger *logrus.Logger, allowedOrigins []string) *WSHandler {
	return &WSHandler{
		hub:     hub,
		inbound: inbound,
		jwt:     jwtProvider,
		logger:  logger,
		upgrader: websocket.Upgrader{
			ReadBufferSize:  1024,
			WriteBufferSize: 1024,
			CheckOrigin:     originChecker(allowedOrigins),
		},
	}
}

// originChecker 按白名单校验 WebSocket 来源，防跨站 WebSocket 劫持（CSWSH）。
// 无 Origin 头（非浏览器客户端，如移动端/服务端）放行；白名单含 "*" 则放行任意源。
func originChecker(allowed []string) func(*http.Request) bool {
	allowAll := false
	set := make(map[string]struct{}, len(allowed))
	for _, o := range allowed {
		if o == "*" {
			allowAll = true
		}
		set[o] = struct{}{}
	}
	return func(r *http.Request) bool {
		origin := r.Header.Get("Origin")
		if origin == "" {
			return true
		}
		if allowAll {
			return true
		}
		_, ok := set[origin]
		return ok
	}
}

// Serve 处理 GET /ws/im：JWT 鉴权后升级为 WebSocket。
//
// 浏览器原生 WebSocket 无法自定义请求头，故 access token 优先从 query 参数 token 传入，
// 兼容 Authorization: Bearer 头（供非浏览器客户端）。
func (h *WSHandler) Serve(c *gin.Context) {
	token := c.Query("token")
	if token == "" {
		token = bearerToken(c.GetHeader("Authorization"))
	}
	claims, err := h.jwt.Parse(token)
	if err != nil || claims.Type == appjwt.TypeRefresh {
		c.AbortWithStatus(http.StatusUnauthorized)
		return
	}
	userID, err := claims.UserID()
	if err != nil {
		c.AbortWithStatus(http.StatusUnauthorized)
		return
	}

	conn, err := h.upgrader.Upgrade(c.Writer, c.Request, nil)
	if err != nil {
		if h.logger != nil {
			h.logger.Warnf("[im] websocket upgrade failed: userId=%d, err=%v", userID, err)
		}
		return // Upgrade 失败时已写入响应
	}

	client := &Client{
		hub:       h.hub,
		conn:      conn,
		userID:    userID,
		send:      make(chan []byte, sendBuffer),
		quit:      make(chan struct{}),
		onMessage: h.onInbound,
	}
	h.hub.register(client)
	go client.writePump()
	go client.readPump()
}

func (h *WSHandler) onInbound(userID int64, raw []byte) {
	if h.inbound != nil {
		h.inbound.HandleInbound(userID, raw)
	}
}

// bearerToken 从 "Bearer xxx" 提取 token。
func bearerToken(h string) string {
	const prefix = "Bearer "
	if len(h) > len(prefix) && h[:len(prefix)] == prefix {
		return h[len(prefix):]
	}
	return ""
}
