import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Framework gzip buffers proxied SSE chunks. Nginx compresses HTML/assets;
  // API event streams must reach the client without waiting for the last chunk.
  compress: false,
  distDir: process.env.NODE_ENV === "development" ? ".next-dev" : ".next",
  devIndicators: false,
  experimental: { proxyClientMaxBodySize: "100mb", proxyTimeout: 3_600_000 },
  async headers() {
    return [{ source: "/:path*", headers: [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "X-Frame-Options", value: "SAMEORIGIN" },
      { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
    ] }];
  },
};
export default nextConfig;
