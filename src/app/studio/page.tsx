import { AccountScope } from "@/components/auth-provider";
import { Suspense } from "react";
import Studio from "@/components/studio";
import { Loading } from "@/components/ui";
export default function StudioPage() { return <Suspense fallback={<Loading label="Opening the studio…" />}><AccountScope><Studio /></AccountScope></Suspense>; }

export const metadata = { title: "Creative studio" };
