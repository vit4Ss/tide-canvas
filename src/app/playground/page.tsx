import { AccountScope } from "@/components/auth-provider";
import { Suspense } from "react";
import Playground from "@/components/playground";
export default function PlaygroundPage() { return <Suspense><AccountScope><Playground /></AccountScope></Suspense>; }

export const metadata = { title: "API playground" };
