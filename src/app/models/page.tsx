import { getPublicModels } from "@/lib/public-info.server";
import { Catalog } from "@/components/catalog";
export default async function Models({ searchParams }: { searchParams: Promise<{ provider?: string | string[] }> }) {
  const { provider } = await searchParams;
  const initialModels = await getPublicModels();
  return <Catalog initialModels={initialModels} key={typeof provider === "string" ? provider : "all"} providerId={typeof provider === "string" ? provider : undefined} />;
}

export const metadata = { title: "Models" };
