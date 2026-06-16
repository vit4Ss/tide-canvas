# syntax=docker/dockerfile:1
# TideCanvas Go 后端 —— 多阶段构建（builder 编译静态二进制；runtime 用 alpine 精简镜像）

# ---------- 构建阶段 ----------
FROM golang:1.24-alpine AS builder
WORKDIR /src

# 国内云服务器拉依赖走七牛镜像；纯静态二进制（无 cgo 依赖）
ENV GOPROXY=https://goproxy.cn,direct \
    CGO_ENABLED=0

# 先下依赖：go.mod/go.sum 不变则命中层缓存、跳过重复下载
COPY go.mod go.sum ./
RUN go mod download

# 再拷源码编译（入口 cmd/server）
COPY . .
RUN go build -trimpath -ldflags="-s -w" -o /out/tide-canvas-go ./cmd/server

# ---------- 运行阶段 ----------
FROM alpine:3.20
# ca-certificates：访问 OSS / SMTP / AI 上游 的 HTTPS；tzdata：东八区时间
RUN apk add --no-cache ca-certificates tzdata \
    && ln -sf /usr/share/zoneinfo/Asia/Shanghai /etc/localtime
WORKDIR /app
COPY --from=builder /out/tide-canvas-go /app/tide-canvas-go
RUN mkdir -p /app/logs
ENV TZ=Asia/Shanghai
EXPOSE 8080
ENTRYPOINT ["/app/tide-canvas-go"]
