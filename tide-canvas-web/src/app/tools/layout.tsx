/* ============================================================================
   /tools 布局 — 独立 AI 工具页的极简壳。

   刻意不带 (site) 的导航/页脚/背景场：工具页是全屏聚焦的单任务界面
   （上传 → 处理 → 结果），右上角 × 返回来路。主题 token 与全站一致
   （body.imini 由根布局直出，这里引入 flux + imini-theme 提供变量）。
   ========================================================================== */

import "@/styles/liuguang/flux.css";
import "@/styles/liuguang/imini-theme.css";
import "./tools.css";

export default function ToolsLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
