"use client";

// React 19 适配补丁：必须在 antd 组件渲染前 import，修复 antd v5 在 React 19 下的 findDOMNode 等问题
import "@ant-design/v5-patch-for-react-19";
import type { ReactNode } from "react";
import { ConfigProvider, theme } from "antd";
import zhCN from "antd/locale/zh_CN";
import { StyleProvider } from "@ant-design/cssinjs";
import { AntdRegistry } from "@ant-design/nextjs-registry";

/**
 * 通用 antd 上下文，可包裹任意需要 antd 组件的区域（管理后台 / 用户侧表格等）。
 * - AntdRegistry：App Router SSR 首屏样式注入，防止刷新闪烁
 * - StyleProvider hashPriority="high"：antd 样式用高优先级（去掉 :where 包裹），覆盖 Tailwind v4
 *   preflight 对 input/button 的全局重置，避免输入框出现「框中框」。不能用 layer——Tailwind v4 的
 *   原生 @layer 会让 antd 样式优先级低于 preflight。
 * - ConfigProvider：中文 locale + 与品牌一致的主色/圆角。antd v5 样式按组件作用域注入，
 *   不含全局 reset，包裹纯 Tailwind 页面不会影响其原有样式。
 */
export function AntdProvider({ children }: { children: ReactNode }) {
  return (
    <AntdRegistry>
      <StyleProvider hashPriority="high">
        <ConfigProvider
          locale={zhCN}
          theme={{
            algorithm: theme.defaultAlgorithm,
            token: {
              colorPrimary: "#1677ff",
              borderRadius: 8,
              fontFamily: "inherit",
            },
            components: {
              Menu: {
                itemSelectedBg: "#e6f0ff",
                itemSelectedColor: "#1677ff",
                itemHoverBg: "#f5f5f5",
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
