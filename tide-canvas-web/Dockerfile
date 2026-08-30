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
# 后端在同宿主机的 8081（8080 已被同机的 relay-backend 占用）；
# 浏览器侧 /api 由边缘 nginx 直接反代后端，不经过 Next。
ARG NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:8081
# 浏览器原生导航（下载等）的公开 API 地址。默认留空＝使用当前网站域名的
# /api，由边缘 nginx 反代；绝不能回退到上面的容器回环地址。
ARG NEXT_PUBLIC_BROWSER_API_BASE_URL=
ARG NEXT_PUBLIC_OAUTH_REDIRECT_BASE=
ARG NEXT_PUBLIC_GITHUB_CLIENT_ID=
ARG NEXT_PUBLIC_GOOGLE_CLIENT_ID=
ARG NEXT_PUBLIC_WECHAT_APP_ID=
ARG NEXT_PUBLIC_APP_VERSION=development
ENV NEXT_PUBLIC_API_BASE_URL=$NEXT_PUBLIC_API_BASE_URL \
    NEXT_PUBLIC_BROWSER_API_BASE_URL=$NEXT_PUBLIC_BROWSER_API_BASE_URL \
    NEXT_PUBLIC_OAUTH_REDIRECT_BASE=$NEXT_PUBLIC_OAUTH_REDIRECT_BASE \
    NEXT_PUBLIC_GITHUB_CLIENT_ID=$NEXT_PUBLIC_GITHUB_CLIENT_ID \
    NEXT_PUBLIC_GOOGLE_CLIENT_ID=$NEXT_PUBLIC_GOOGLE_CLIENT_ID \
    NEXT_PUBLIC_WECHAT_APP_ID=$NEXT_PUBLIC_WECHAT_APP_ID \
    NEXT_PUBLIC_APP_VERSION=$NEXT_PUBLIC_APP_VERSION \
    NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# ====== Stage 3: 运行 ======
FROM node:22-slim AS runner
WORKDIR /app
# HOSTNAME=127.0.0.1：host 网络下 Next 只监听回环，公网流量统一由独立的边缘 nginx
# 容器（80/443 + 证书）按域名分流进来
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=127.0.0.1 \
    PORT=3000

RUN groupadd --system nodejs && useradd --system --gid nodejs nextjs

# standalone 产物不含 public 与 .next/static，需手动拷入由 server.js 一并伺服
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
