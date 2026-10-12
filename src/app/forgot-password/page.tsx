import { Suspense } from "react";
import AuthScreen from "@/components/auth-screen";
export default function ForgotPassword() { return <Suspense><AuthScreen mode="reset" /></Suspense>; }

export const metadata = { title: "Reset password" };
