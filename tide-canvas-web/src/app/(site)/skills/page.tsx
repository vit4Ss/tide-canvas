import type { Metadata } from "next";
import { SkillLibrary } from "@/components/skills/skill-library";

export const metadata: Metadata = { title: "Skill 广场 · FlowLight", description: "发现专业 Skill，将它们安装到你的 AI 客户端，通过 MCP 调用 FlowLight 云端能力。" };

export default function SkillsPage() { return <SkillLibrary />; }
