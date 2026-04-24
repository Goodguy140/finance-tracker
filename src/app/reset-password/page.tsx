import Link from "next/link";
import { PasswordResetForm } from "@/components/forms";

export default function ResetPasswordPage() {
  return (
    <main className="mx-auto mt-20 max-w-md rounded-2xl border border-slate-800 bg-slate-900/80 p-6 shadow-xl backdrop-blur">
      <h1 className="mb-4 text-2xl font-semibold text-slate-100">Reset Password</h1>
      <PasswordResetForm />
      <p className="mt-4 text-sm text-slate-400">
        Back to <Link href="/login" className="text-blue-300 hover:text-blue-200 underline">login</Link>
      </p>
    </main>
  );
}
