import { AccountScope } from "@/components/auth-provider";
import { Suspense } from "react";
import Account from "@/components/account";
export default function AccountPage() { return <Suspense><AccountScope><Account /></AccountScope></Suspense>; }

export const metadata = { title: "Account" };
