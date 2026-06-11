import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Docker 部署：构建产出 .next/standalone 自包含产物（无需携带完整 node_modules）
  output: "standalone",
  // Next 16 的 typedRoutes 生成器在跨路由组的动态段(community/[id] 同时存在于 (public) 与 (auth))
  // 上会生成损坏的 .next/dev/types/routes.d.ts，导致路由表注册失败、全站 404。关闭以规避该 bug。
  typedRoutes: false,
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "**",
      },
    ],
  },
  experimental: {
    // rewrites() 代理上传时 Next 会缓冲请求体，默认上限仅 10MB，超出会被截断
    // 导致后端 multipart 解析 EOFException。提到与后端 max-request-size(100MB) 对齐。
    proxyClientMaxBodySize: "100mb",
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
