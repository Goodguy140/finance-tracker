import Link from "next/link";
import { PasswordResetRequestForm } from "@/components/forms";

export default function ForgotPasswordPage() {
  return (
    <main className="mx-auto mt-20 max-w-md rounded-2xl border border-slate-800 bg-slate-900/80 p-6 shadow-xl backdrop-blur">
      <h1 className="mb-4 text-2xl font-semibold text-slate-100">Forgot Password</h1>
      <PasswordResetRequestForm />
      <p className="mt-4 text-sm text-slate-400">
        Have a reset token? <Link href="/reset-password" className="text-blue-300 hover:text-blue-200 underline">Reset password</Link>
      </p>
    </main>
  );
}
