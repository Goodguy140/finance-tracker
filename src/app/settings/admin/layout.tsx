import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import { AdminNav } from "@/components/admin/admin-nav";
import { getAdminAttention } from "@/lib/admin-attention-facts";
import { requireAdmin } from "@/lib/session";

export default async function AdminLayout({ children }: { children: ReactNode }) {
  // Every page below checks again: a layout is not re-rendered on client navigation, so it
  // cannot be the only guard.
  await requireAdmin();
  const { badges } = await getAdminAttention();

  return (
    <main className="mx-auto mb-6 mt-[max(1.5rem,env(safe-area-inset-top))] max-w-6xl p-4 text-slate-100">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-6 w-6 text-sky-300" aria-hidden />
          <h1 className="text-2xl font-semibold">Server admin</h1>
        </div>
        <Link
          href="/settings"
          className="inline-flex items-center gap-1 text-sm text-blue-300 underline hover:text-blue-200"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          Back to settings
        </Link>
      </div>
      {/* minmax(0,1fr) on phones too: an auto column would grow to fit the nav strip's full
          width, pushing the whole page wider than the viewport. */}
      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[13rem_minmax(0,1fr)]">
        <aside className="min-w-0">
          <AdminNav badges={badges} />
        </aside>
        <div className="min-w-0 space-y-4">{children}</div>
      </div>
    </main>
  );
}
