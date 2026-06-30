# TideCanvas 前端（monorepo / Turborepo，apps/web = Next 16）
# 构建上下文 = 本 monorepo 根（tide-canvas-frontend）。
# 基镜像用 Debian slim(glibc) 而非 alpine(musl)：package-lock 只锁了 glibc 的
# @next/swc-linux-x64-gnu，musl 变体缺失会让 Turbopack 构建失败。

# ====== Stage 1: 依赖安装（按 workspace 的 package.json 做缓存层）======
FROM node:22-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/package.json
COPY packages/ui/package.json packages/ui/package.json
COPY packages/eslint-config/package.json packages/eslint-config/package.json
COPY packages/typescript-config/package.json packages/typescript-config/package.json
RUN npm ci

# ====== Stage 2: 构建 ======
FROM node:22-slim AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# API_BASE_URL is server-only and read by Next route handlers at runtime.
ARG API_BASE_URL=http://backend:8080
ARG NEXT_PUBLIC_OAUTH_REDIRECT_BASE=
ENV API_BASE_URL=$API_BASE_URL \
    NEXT_PUBLIC_OAUTH_REDIRECT_BASE=$NEXT_PUBLIC_OAUTH_REDIRECT_BASE \
    NEXT_TELEMETRY_DISABLED=1
# Build the Next app directly to avoid depending on Turbo cache/log state in production images.
RUN npm --workspace web run build

# ====== Stage 3: 运行（standalone 自包含产物）======
FROM node:22-slim AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000 \
    API_BASE_URL=http://backend:8080

RUN groupadd --system nodejs && useradd --system --gid nodejs nextjs

# outputFileTracingRoot=monorepo 根 → standalone 内为 apps/web/server.js + node_modules + packages/*
COPY --from=builder /app/apps/web/public ./apps/web/public
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/static ./apps/web/.next/static

USER nextjs
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
