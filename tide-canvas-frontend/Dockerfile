# TideCanvas 前端镜像：monorepo / Turborepo，apps/web 是 Next 16 应用。
# 构建上下文为 tide-canvas-frontend 根目录。
# 使用 Debian slim(glibc)，避免 alpine(musl) 缺少 Next SWC glibc 变体导致构建失败。

# ====== Stage 1: 安装依赖 ======
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
COPY --from=deps /app/apps/web/node_modules ./apps/web/node_modules
COPY . .

ARG API_BASE_URL=http://backend:8080
ARG NEXT_PUBLIC_OAUTH_REDIRECT_BASE=
ENV API_BASE_URL=$API_BASE_URL \
    NEXT_PUBLIC_OAUTH_REDIRECT_BASE=$NEXT_PUBLIC_OAUTH_REDIRECT_BASE \
    NEXT_TELEMETRY_DISABLED=1
RUN npm --workspace web run build

# ====== Stage 3: 运行 ======
FROM node:22-slim AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000 \
    API_BASE_URL=http://backend:8080

RUN groupadd --system nodejs && useradd --system --gid nodejs nextjs

# outputFileTracingRoot 指向 monorepo 根目录，standalone 内包含 apps/web/server.js、node_modules 和 packages/*。
COPY --from=builder /app/apps/web/public ./apps/web/public
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/static ./apps/web/.next/static

USER nextjs
EXPOSE 3000
CMD ["node", "apps/web/server.js"]