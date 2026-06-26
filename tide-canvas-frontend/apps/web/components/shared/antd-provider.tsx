"use client";

import type { ReactNode } from "react";
import { ConfigProvider, theme } from "antd";
import zhCN from "antd/locale/zh_CN";
import { StyleProvider } from "@ant-design/cssinjs";
import { AntdRegistry } from "@ant-design/nextjs-registry";
import { useThemeMode } from "./theme-mode";

/**
 * 通用 antd 上下文，可包裹任意需要 antd 组件的区域（管理后台 / 用户侧表格等）。
 * 主题模式来自 ThemeModeProvider（无则默认浅色），用于切换 default/dark 算法。
 * - AntdRegistry：App Router SSR 首屏样式注入
 * - StyleProvider hashPriority="high"：antd 样式高优先级，覆盖 Tailwind v4 preflight
 * - ConfigProvider：中文 locale + 品牌主色/圆角
 */
export function AntdProvider({ children }: { children: ReactNode }) {
  const { mode } = useThemeMode();
  const isDark = mode === "dark";
  return (
    <AntdRegistry>
      <StyleProvider hashPriority="high">
        <ConfigProvider
          locale={zhCN}
          theme={{
            cssVar: { key: "tide" },
            algorithm: isDark ? theme.darkAlgorithm : theme.defaultAlgorithm,
            token: {
              colorPrimary: "#1677ff",
              borderRadius: 8,
              fontFamily: "inherit",
            },
            components: {
              Menu: {
                itemSelectedBg: isDark ? "#111a2c" : "#e6f0ff",
                itemSelectedColor: "#1677ff",
                itemHoverBg: isDark ? "#1f1f1f" : "#f5f5f5",
                itemBorderRadius: 8,
              },
            },
          }}
        >
          {children}
        </ConfigProvider>
      </StyleProvider>
    </AntdRegistry>
  );
}
