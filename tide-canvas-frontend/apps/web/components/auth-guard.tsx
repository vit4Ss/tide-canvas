"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/hooks/use-auth";

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const { isLoggedIn, initialized } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (initialized && !isLoggedIn) {
      router.replace("/login");
    }
  }, [initialized, isLoggedIn, router]);

  if (!initialized) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-neutral-300 border-t-neutral-900" />
      </div>
    );
  }

  if (!isLoggedIn) return null;

  return <>{children}</>;
}
