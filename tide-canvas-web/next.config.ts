import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Docker 部署：构建产出 .next/standalone 自包含产物（无需携带完整 node_modules）
  output: "standalone",
  // Next dev 工具指示器默认停在左下角，恰好压住画布工具栏的「资产管理」按钮
  // （右下是 AI 助手 FAB，左上有项目名 pill，只有右上无控件）。仅影响 dev。
  devIndicators: { position: "top-right" },
  // Next 16 的 typedRoutes 生成器在跨路由组的动态段(community/[id] 同时存在于 (public) 与 (auth))
  // 上会生成损坏的 .next/dev/types/routes.d.ts，导致路由表注册失败、全站 404。关闭以规避该 bug。
  typedRoutes: false,
  images: {
    // 显式列出作品图所在的存储域（创作台环境光取色借道 /_next/image 同源
    // 代理，依赖这个白名单）：OSS 直链 + CDN 加速域名。
    remotePatterns: [
      { protocol: "https", hostname: "**.aliyuncs.com" },
      { protocol: "https", hostname: "cdn.mbfczzzz.top" },
    ],
    // Next 16 默认拦截解析到私有 IP 的上游图（本机代理 fake-ip 模式下 OSS
    // 域名会解析到 198.18.x.x 私网段而被误杀）。仅开发环境放行。
    ...(process.env.NODE_ENV === "development" ? { dangerouslyAllowLocalIP: true } : {}),
  },
  experimental: {
    // rewrites() 代理上传时 Next 会缓冲请求体，默认上限仅 10MB，超出会被截断
    // 导致后端 multipart 解析 EOFException。提到与后端 max-request-size(100MB) 对齐。
    proxyClientMaxBodySize: "100mb",
    // 代理默认 30s 超时：博客 TG 频道首次同步（抓预览+图片转存）可能超过它，
    // 后端明明 200 浏览器却收到代理的 500。对齐边缘 nginx 的长超时口径。
    proxyTimeout: 300_000,
  },
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8080"}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
