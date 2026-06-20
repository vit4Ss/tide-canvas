"use client";

import Link from "next/link";
import { Layers, Menu, X, MessageSquare, BookOpen } from "lucide-react";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { HeaderActions } from "./header-actions";

const navLinks = [
  { href: "/user/projects", labelKey: "canvas", icon: Layers },
  { href: "/community", labelKey: "community", icon: MessageSquare },
  { href: "/blogs", labelKey: "blog", icon: BookOpen },
  // 「发现」功能开发中，暂时隐藏：{ href: "/explore", labelKey: "explore", icon: Compass },
];

export function Header() {
  const t = useTranslations();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <header className="sticky top-0 z-50 border-b border-neutral-200 bg-white/80 backdrop-blur-lg dark:border-neutral-800 dark:bg-neutral-950/80">
      <div className="flex h-16 items-center justify-between px-4 sm:px-6 lg:px-8">
        <div className="flex items-center gap-8">
          <Link href="/" className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-neutral-900 dark:bg-white">
              <Layers className="h-4 w-4 text-white dark:text-neutral-900" />
            </div>
            <span className="text-lg font-bold tracking-tight">TideCanvas</span>
          </Link>

          <nav className="hidden items-center gap-1 md:flex">
            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm text-neutral-600 transition-colors hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-white"
              >
                <link.icon className="h-4 w-4" />
                {t(`nav.${link.labelKey}`)}
              </Link>
            ))}
          </nav>
        </div>

        <div className="flex items-center gap-3">
          <HeaderActions />

          <button
            className="rounded-lg p-2 md:hidden"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          >
            {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>

      {mobileMenuOpen && (
        <div className="border-t border-neutral-200 bg-white px-4 py-3 md:hidden dark:border-neutral-800 dark:bg-neutral-950">
          <nav className="flex flex-col gap-1">
            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-neutral-600 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-800"
                onClick={() => setMobileMenuOpen(false)}
              >
                <link.icon className="h-4 w-4" />
                {t(`nav.${link.labelKey}`)}
              </Link>
            ))}
          </nav>
        </div>
      )}
    </header>
  );
}
