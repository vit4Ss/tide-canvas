import type { NextConfig } from "next";
import path from "node:path";
import { fileURLToPath } from "node:url";
import createNextIntlPlugin from "next-intl/plugin";

// next-intl：无路由前缀模式，locale 存 cookie；request 配置在 ./i18n/request.ts
const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

const here = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  allowedDevOrigins: ["localhost", "127.0.0.1", "localhost:3100", "127.0.0.1:3100", "http://localhost:3100", "http://127.0.0.1:3100"],
  // monorepo：转译共享 UI 包
  transpilePackages: ["@workspace/ui"],
  // monorepo standalone：文件追踪根设到 monorepo 根，产物含 packages/ui 等 workspace 依赖
  outputFileTracingRoot: path.join(here, "../../"),
  // Docker 部署：自包含 standalone 产物
  output: "standalone",
  // 跨路由组动态段会让 typedRoutes 生成损坏类型，关闭规避
  typedRoutes: false,
  images: {
    remotePatterns: [{ protocol: "https", hostname: "**" }],
  },
  experimental: {
    // rewrites 代理上传时默认 10MB 上限会截断请求体，提到与后端对齐
    proxyClientMaxBodySize: "100mb",
  },
};

export default withNextIntl(nextConfig);
