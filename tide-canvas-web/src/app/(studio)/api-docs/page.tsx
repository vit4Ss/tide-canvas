import type { Metadata } from "next";
import GenerationAPIDocs from "./generation-api-docs";

export const metadata: Metadata = { title: "生成 API 文档 · FlowingLight" };

export default function Page() { return <GenerationAPIDocs />; }
