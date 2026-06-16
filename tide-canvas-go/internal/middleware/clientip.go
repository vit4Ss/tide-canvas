package middleware

import (
	"net"
	"strings"

	"github.com/gin-gonic/gin"
)

// 客户端真实 IP 提取（对齐旧后端 util/IpUtil.getClientIp）。
//
// 服务部署在反向代理（Next.js rewrite / nginx）之后，gin 的 RemoteIP() 拿到的是代理 IP，
// 故优先按代理头链取真实客户端 IP；需确保代理层正确透传这些头，否则 IP 维度会退化为代理 IP。

// 代理头优先级（与 IpUtil 的 headers 数组一致）。
var clientIPHeaders = []string{
	"X-Forwarded-For", "Proxy-Client-IP", "WL-Proxy-Client-IP",
	"HTTP_CLIENT_IP", "HTTP_X_FORWARDED_FOR", "X-Real-IP",
}

// ClientIP 提取客户端真实 IP：依次检查代理头，取首个有效（非空、非 "unknown"）值的链首段，
// 全部缺失则回退 gin 解析出的 RemoteAddr（已去掉端口）。对齐 IpUtil.getClientIp。
func ClientIP(c *gin.Context) string {
	if c == nil || c.Request == nil {
		return ""
	}
	for _, h := range clientIPHeaders {
		v := c.GetHeader(h)
		if v == "" || strings.EqualFold(v, "unknown") {
			continue
		}
		// X-Forwarded-For 可能是 "client, proxy1, proxy2"，取第一段。
		return strings.TrimSpace(strings.Split(v, ",")[0])
	}
	return remoteAddr(c)
}

// remoteAddr 返回去掉端口的远端地址（对齐 request.getRemoteAddr 的语义）。
// gin 的 c.Request.RemoteAddr 形如 "ip:port"；解析失败则原样返回。
func remoteAddr(c *gin.Context) string {
	addr := c.Request.RemoteAddr
	if addr == "" {
		return ""
	}
	if host, _, err := net.SplitHostPort(addr); err == nil {
		return host
	}
	return addr
}
