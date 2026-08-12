# Tide Canvas 后端镜像。
# 部署形态：network_mode: host —— 进程直接占用宿主机 8080，
# 通过 127.0.0.1:3306 / 127.0.0.1:6379 连接宿主机上的 MySQL/Redis
# （与 configs/config.yaml 的测试默认值一致）。环境由 TIDECANVAS_ENV 选择。

# ====== Stage 1: 编译 ======
FROM golang:1.24-alpine AS builder
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/api ./cmd/api

# ====== Stage 2: 运行 ======
FROM alpine:3.20
# ca-certificates: 出站 HTTPS（OSS/Relay/Anthropic/SMTP）；tzdata: DSN loc=Local 用上海时区
# ffmpeg 提供 ffprobe：视频超分提交前由服务端读取真实媒体时长，作为权威计费依据。
RUN apk add --no-cache ca-certificates tzdata ffmpeg
ENV TZ=Asia/Shanghai \
    TIDECANVAS_ENV=test
WORKDIR /app
COPY --from=builder /out/api ./api
# 配置文件打进镜像（viper 从 ./configs 读取）；密钥仍走 TIDECANVAS_* 环境变量注入
COPY configs ./configs
# local 存储模式的上传目录（compose 挂 volume 持久化）
RUN mkdir -p /app/data/uploads
EXPOSE 8080
CMD ["./api"]
