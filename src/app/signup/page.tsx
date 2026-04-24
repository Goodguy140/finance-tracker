import Link from "next/link";
import { SignupForm } from "@/components/forms";

export default function SignupPage() {
  return (
    <main className="mx-auto mt-20 max-w-md rounded-2xl border border-slate-800 bg-slate-900/80 p-6 text-slate-100 shadow-xl backdrop-blur">
      <h1 className="mb-4 text-2xl font-semibold text-slate-100">Sign up</h1>
      <SignupForm />
      <p className="mt-4 text-sm text-slate-400">
        Already have an account? <Link href="/login" className="font-medium text-blue-300 hover:text-blue-200 underline">Login</Link>
      </p>
    </main>
  );
}
