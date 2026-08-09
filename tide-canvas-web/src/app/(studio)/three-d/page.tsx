/* /three-d — 3D 模型工作台。

   Server entry: owns the route <title>, renders the client <ThreeDStudio/>
   (参数面板 + three.js viewport + 历史条带) inside the (studio) rail layout.
   3D 生成从创作台独立成页（2026-08）：交互式模型预览需要整幅 viewport。 */

import type { Metadata } from "next";
import ThreeDStudio from "@/components/studio/three-d-studio";

export const metadata: Metadata = {
  title: "3D 模型 · 流光 FlowingLight",
};

export default function ThreeDPage() {
  return <ThreeDStudio />;
}
