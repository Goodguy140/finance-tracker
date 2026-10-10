import type { ReactNode } from "react";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { AdminNav } from "@/components/admin/admin-nav";
import { getAdminAttention } from "@/lib/admin-attention-facts";
import { requireAdmin } from "@/lib/session";

/**
 * The admin pages sit inside the Settings shell like any other section; their own nav is a
 * strip of links above the page rather than a second sidebar.
 */
export default async function AdminLayout({ children }: { children: ReactNode }) {
  // Every page below checks again: a layout is not re-rendered on client navigation, so it
  // cannot be the only guard.
  await requireAdmin();
  const { badges } = await getAdminAttention();

  return (
    <div className="min-w-0 space-y-5">
      <Link
        href="/settings"
        className="-ml-1 inline-flex items-center gap-0.5 text-sm text-blue-300 hover:text-blue-200 lg:hidden"
      >
        <ChevronLeft className="h-4 w-4" aria-hidden />
        Settings
      </Link>
      <p className="text-xs font-medium uppercase tracking-wider text-slate-500">Server admin</p>
      <AdminNav badges={badges} />
      <div className="min-w-0 space-y-4">{children}</div>
    </div>
  );
}
