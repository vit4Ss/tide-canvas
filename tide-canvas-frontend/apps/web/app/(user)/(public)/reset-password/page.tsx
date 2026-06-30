import { Suspense } from "react";
import { ResetPasswordForm } from "@/components/auth/reset-password-form";

function ResetPasswordFallback() {
  return <div className="fixed inset-0 bg-black" />;
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<ResetPasswordFallback />}>
      <ResetPasswordForm />
    </Suspense>
  );
}
