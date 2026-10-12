import { Suspense } from "react";
import AuthScreen from "@/components/auth-screen";
export default function Signup() { return <Suspense><AuthScreen mode="signup" /></Suspense>; }

export const metadata = { title: "Create your account" };
