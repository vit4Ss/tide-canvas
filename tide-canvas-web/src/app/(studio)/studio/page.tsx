/* /studio — 创作台 · STUDIO workstation.

   Server entry: owns the route <title>, renders the client <CreateStudio/>
   (panel + stage + 生成历史) inside the (studio) rail layout. All interactivity
   (model picker, simulated generation, history) lives in the client component. */

import type { Metadata } from "next";
import CreateStudio from "@/components/studio/create-studio";

export const metadata: Metadata = {
  title: "创作台 · 流光 FlowingLight",
};

export default function StudioPage() {
  return <CreateStudio />;
}
