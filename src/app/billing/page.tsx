import { AccountScope } from "@/components/auth-provider";
import { Suspense } from "react";
import Billing from "@/components/billing";
export default function BillingPage() { return <Suspense><AccountScope><Billing /></AccountScope></Suspense>; }

export const metadata = { title: "Checkout" };
