# 基镜像用 Debian slim(glibc)而非 alpine(musl)：Windows 上生成的 package-lock.json
# 只锁入了 @next/swc-linux-x64-gnu(glibc)原生绑定，musl 变体缺失会导致
# Next 16 的 Turbopack 构建在 alpine 上直接失败（Turbopack 不支持 WASM 兜底）。
# ====== Stage 1: 依赖安装 ======
FROM node:22-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ====== Stage 2: 构建 ======
FROM node:22-slim AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# NEXT_PUBLIC_* 与 rewrites 目标在构建期内联/固化，必须以 build-arg 传入。
# API_BASE_URL 用于 SSR 直连与 /api/* 代理目标：部署为 network_mode: host，
# 后端就在同宿主机的 8080，故默认 127.0.0.1（浏览器侧 /api 由镜像内 nginx 直接反代后端）。
ARG NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:8080
ARG NEXT_PUBLIC_OAUTH_REDIRECT_BASE=
ARG NEXT_PUBLIC_GITHUB_CLIENT_ID=
ARG NEXT_PUBLIC_GOOGLE_CLIENT_ID=
ARG NEXT_PUBLIC_WECHAT_APP_ID=
ENV NEXT_PUBLIC_API_BASE_URL=$NEXT_PUBLIC_API_BASE_URL \
    NEXT_PUBLIC_OAUTH_REDIRECT_BASE=$NEXT_PUBLIC_OAUTH_REDIRECT_BASE \
    NEXT_PUBLIC_GITHUB_CLIENT_ID=$NEXT_PUBLIC_GITHUB_CLIENT_ID \
    NEXT_PUBLIC_GOOGLE_CLIENT_ID=$NEXT_PUBLIC_GOOGLE_CLIENT_ID \
    NEXT_PUBLIC_WECHAT_APP_ID=$NEXT_PUBLIC_WECHAT_APP_ID \
    NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# ====== Stage 3: 运行（node SSR + nginx 终结 TLS） ======
FROM node:22-slim AS runner
WORKDIR /app
# HOSTNAME=127.0.0.1：host 网络下 Next 只监听回环，对外仅暴露 nginx 的 80/443
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=127.0.0.1 \
    PORT=3000

RUN apt-get update \
    && apt-get install -y --no-install-recommends nginx \
    && rm -rf /var/lib/apt/lists/* \
    # debian nginx 自带的 default 站点会抢占 80，移除
    && rm -f /etc/nginx/sites-enabled/default

COPY deploy/nginx.conf /etc/nginx/conf.d/tidecanvas.conf
COPY deploy/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# standalone 产物不含 public 与 .next/static，需手动拷入由 server.js 一并伺服
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

# nginx 需要 root 绑定 80/443（host 网络），不再降权运行
EXPOSE 80 443
CMD ["/entrypoint.sh"]
