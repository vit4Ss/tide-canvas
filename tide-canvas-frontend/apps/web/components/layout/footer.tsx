import Link from "next/link";
import { BrandMark } from "@/components/shared/brand-mark";

const footerLinks = [
  {
    title: "产品",
    links: [
      { label: "无限画布", href: "/canvas/new" },
      { label: "AI 模型", href: "/explore" },
      { label: "素材库", href: "/user/assets" },
    ],
  },
  {
    title: "资源",
    links: [
      { label: "帮助文档", href: "#" },
      { label: "API 文档", href: "#" },
      { label: "更新日志", href: "#" },
    ],
  },
  {
    title: "关于",
    links: [
      { label: "关于我们", href: "#" },
      { label: "服务协议", href: "#" },
      { label: "隐私政策", href: "#" },
    ],
  },
];

export function Footer() {
  return (
    <footer className="border-t border-neutral-200 bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-950">
      <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
        <div className="grid grid-cols-2 gap-8 md:grid-cols-4">
          <div className="col-span-2 md:col-span-1">
            <Link href="/" className="flex items-center gap-2">
              <BrandMark className="h-8 w-8" />
              <span className="text-lg font-bold">TideCanvas</span>
            </Link>
            <p className="mt-3 text-sm text-neutral-500 dark:text-neutral-400">
              基于无限画布的多模态 AI 创作平台，让创作从单次生成变成连续推演。
            </p>
          </div>

          {footerLinks.map((group) => (
            <div key={group.title}>
              <h3 className="text-sm font-semibold text-neutral-900 dark:text-white">
                {group.title}
              </h3>
              <ul className="mt-3 space-y-2">
                {group.links.map((link) => (
                  <li key={link.label}>
                    <Link
                      href={link.href}
                      className="text-sm text-neutral-500 transition-colors hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-white"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-10 border-t border-neutral-200 pt-6 dark:border-neutral-800">
          <p className="text-center text-sm text-neutral-400">
            &copy; {new Date().getFullYear()} TideCanvas. All rights reserved.
          </p>
        </div>
      </div>
    </footer>
  );
}
