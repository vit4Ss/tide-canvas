"use client";

import { Check, Palette, RotateCcw, Rows3, Type, X } from "lucide-react";
import {
  DENSITY_OPTIONS,
  FONT_SIZE_OPTIONS,
  THEME_COLORS,
  type UiDensity,
  type UiThemeColor,
  useUiPreferences,
} from "@/components/shared/ui-preferences";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function UiPreferencesDialog({ open, onOpenChange }: Props) {
  const { preferences, setPreferences, resetPreferences } = useUiPreferences();

  if (!open) return null;

  const setFontSize = (fontSize: number) => setPreferences((current) => ({ ...current, fontSize }));
  const setThemeColor = (themeColor: UiThemeColor) => setPreferences((current) => ({ ...current, themeColor }));
  const setDensity = (density: UiDensity) => setPreferences((current) => ({ ...current, density }));
  const activeColor = THEME_COLORS[preferences.themeColor];

  return (
    <div className="fixed inset-0 z-[260] flex items-center justify-center bg-black/35 p-6 backdrop-blur-[2px]" onMouseDown={() => onOpenChange(false)}>
      <section
        role="dialog"
        aria-modal="true"
        aria-label="界面设置"
        className="w-[min(720px,calc(100vw-48px))] overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-2xl shadow-black/20 dark:border-neutral-800 dark:bg-neutral-950"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-neutral-100 px-6 py-5 dark:border-neutral-800">
          <div>
            <h2 className="text-lg font-semibold text-neutral-950 dark:text-neutral-50">界面设置</h2>
            <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">统一字体、字号、主题色和界面密度。</p>
          </div>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="flex h-9 w-9 items-center justify-center rounded-xl text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-900 dark:hover:bg-neutral-900 dark:hover:text-neutral-100"
            title="关闭"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="grid gap-6 px-6 py-6">
          <section className="grid gap-3">
            <SettingTitle icon={Type} title="字体大小" description={`当前根字号 ${preferences.fontSize}px，所有 rem 字号会同步缩放。`} />
            <div className="grid grid-cols-4 gap-2 rounded-2xl bg-neutral-100 p-1.5 dark:bg-neutral-900">
              {FONT_SIZE_OPTIONS.map((item) => {
                const active = preferences.fontSize === item.value;
                return (
                  <button
                    key={item.value}
                    type="button"
                    onClick={() => setFontSize(item.value)}
                    className={`flex h-12 flex-col items-center justify-center rounded-xl text-sm transition ${
                      active
                        ? "bg-white font-semibold text-neutral-950 shadow-sm dark:bg-neutral-800 dark:text-neutral-50"
                        : "text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
                    }`}
                  >
                    <span>{item.label}</span>
                    <span className="text-xs font-normal text-neutral-400">{item.value}px</span>
                  </button>
                );
              })}
            </div>
          </section>

          <section className="grid gap-3">
            <SettingTitle icon={Palette} title="主题颜色" description="用于按钮、选中态、焦点环和后续统一控件主题。" />
            <div className="grid grid-cols-6 gap-2">
              {(Object.entries(THEME_COLORS) as Array<[UiThemeColor, typeof THEME_COLORS[UiThemeColor]]>).map(([key, item]) => {
                const active = preferences.themeColor === key;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setThemeColor(key)}
                    className={`flex h-16 flex-col items-center justify-center gap-1 rounded-2xl border transition ${
                      active ? "border-neutral-950 bg-neutral-50 dark:border-neutral-100 dark:bg-neutral-900" : "border-neutral-200 hover:border-neutral-300 dark:border-neutral-800"
                    }`}
                  >
                    <span className="relative flex h-6 w-6 items-center justify-center rounded-full" style={{ background: item.color }}>
                      {active && <Check className="h-3.5 w-3.5 text-white" />}
                    </span>
                    <span className="text-xs text-neutral-600 dark:text-neutral-300">{item.label}</span>
                  </button>
                );
              })}
            </div>
          </section>

          <section className="grid gap-3">
            <SettingTitle icon={Rows3} title="界面密度" description="先保存偏好，后续工具栏和面板逐步接入同一套密度变量。" />
            <div className="grid grid-cols-3 gap-2">
              {DENSITY_OPTIONS.map((item) => {
                const active = preferences.density === item.value;
                return (
                  <button
                    key={item.value}
                    type="button"
                    onClick={() => setDensity(item.value)}
                    className={`rounded-2xl border p-4 text-left transition ${
                      active ? "border-neutral-950 bg-neutral-50 dark:border-neutral-100 dark:bg-neutral-900" : "border-neutral-200 hover:border-neutral-300 dark:border-neutral-800"
                    }`}
                  >
                    <div className="text-sm font-semibold text-neutral-950 dark:text-neutral-50">{item.label}</div>
                    <div className="mt-1 text-xs leading-5 text-neutral-500 dark:text-neutral-400">{item.description}</div>
                  </button>
                );
              })}
            </div>
          </section>

          <section className="rounded-2xl border border-neutral-200 bg-neutral-50 p-4 dark:border-neutral-800 dark:bg-neutral-900/60">
            <div className="mb-3 text-sm font-semibold text-neutral-950 dark:text-neutral-50">预览</div>
            <div className="rounded-xl bg-white p-4 shadow-sm dark:bg-neutral-950">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-neutral-950 dark:text-neutral-50">GPT Image 2</div>
                  <div className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">16:9 · 标准画质 · 2K</div>
                </div>
                <button
                  type="button"
                  className="rounded-xl px-3 py-2 text-sm font-medium text-white"
                  style={{ background: activeColor.color, color: activeColor.foreground }}
                >
                  应用
                </button>
              </div>
              <p className="mt-4 text-sm leading-6 text-neutral-600 dark:text-neutral-300">
                当前界面统一使用 Inter 字体，字号和主题色会立即应用并在刷新后保留。
              </p>
            </div>
          </section>
        </div>

        <footer className="flex items-center justify-between border-t border-neutral-100 px-6 py-4 dark:border-neutral-800">
          <button
            type="button"
            onClick={resetPreferences}
            className="inline-flex h-10 items-center gap-2 rounded-xl px-3 text-sm text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-900 dark:hover:bg-neutral-900 dark:hover:text-neutral-100"
          >
            <RotateCcw className="h-4 w-4" />
            恢复默认
          </button>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="inline-flex h-10 items-center rounded-xl px-4 text-sm font-medium text-white"
            style={{ background: activeColor.color, color: activeColor.foreground }}
          >
            完成
          </button>
        </footer>
      </section>
    </div>
  );
}

function SettingTitle({
  icon: Icon,
  title,
  description,
}: {
  icon: typeof Type;
  title: string;
  description: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-neutral-100 text-neutral-700 dark:bg-neutral-900 dark:text-neutral-300">
        <Icon className="h-4 w-4" />
      </span>
      <div>
        <div className="text-sm font-semibold text-neutral-950 dark:text-neutral-50">{title}</div>
        <p className="mt-1 text-xs leading-5 text-neutral-500 dark:text-neutral-400">{description}</p>
      </div>
    </div>
  );
}
