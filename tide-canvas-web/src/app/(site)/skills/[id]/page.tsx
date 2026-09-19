import { SkillLibraryDetail } from "@/components/skills/skill-library-detail";

export default async function SkillDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <SkillLibraryDetail key={id} id={id} />;
}
