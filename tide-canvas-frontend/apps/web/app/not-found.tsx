import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center">
      <p className="text-7xl font-bold tracking-tight text-neutral-200 dark:text-neutral-800">404</p>
      <h1 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">页面不存在</h1>
      <p className="text-sm text-neutral-500">你访问的页面不存在</p>
      <Link
        href="/"
        className="mt-2 rounded-lg bg-neutral-900 px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-neutral-800 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
      >
        返回首页
      </Link>
    </div>
  );
}
