import Link from "next/link";
import { LoginForm } from "@/components/forms";

export default function LoginPage() {
  return (
    <main className="mx-auto mt-20 max-w-md rounded-2xl border border-slate-800 bg-slate-900/80 p-6 text-slate-100 shadow-xl backdrop-blur">
      <h1 className="mb-4 text-2xl font-semibold text-slate-100">Login</h1>
      <LoginForm />
      <div className="mt-4 space-y-1 text-sm text-slate-400">
        <p>
          No account? <Link href="/signup" className="font-medium text-blue-300 hover:text-blue-200 underline">Sign up</Link>
        </p>
        <p>
          Forgot password? <Link href="/forgot-password" className="font-medium text-blue-300 hover:text-blue-200 underline">Reset it</Link>
        </p>
      </div>
    </main>
  );
}
