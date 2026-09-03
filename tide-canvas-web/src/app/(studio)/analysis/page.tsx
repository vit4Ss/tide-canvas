import type { Metadata } from "next";
import AnalysisWorkbench from "./analysis-workbench";

export const metadata: Metadata = {
  title: "内容拆解 · 流光 FlowingLight",
};

export default function AnalysisPage() {
  return <AnalysisWorkbench />;
}
