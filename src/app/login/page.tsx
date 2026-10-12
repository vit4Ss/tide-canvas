import { Suspense } from "react";
import AuthScreen from "@/components/auth-screen";
export default function Login() { return <Suspense><AuthScreen mode="login" /></Suspense>; }

export const metadata = { title: "Sign in" };
