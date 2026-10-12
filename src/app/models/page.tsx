import { Catalog } from "@/components/catalog";
export default async function Models({ searchParams }: { searchParams: Promise<{ provider?: string | string[] }> }) {
  const { provider } = await searchParams;
  return <Catalog key={typeof provider === "string" ? provider : "all"} providerId={typeof provider === "string" ? provider : undefined} />;
}

export const metadata = { title: "Models" };
