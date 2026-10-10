import type { ReactNode } from "react";
import Link from "next/link";
import { SettingsNav } from "@/components/settings/settings-nav";
import { getAdminAttention } from "@/lib/admin-attention-facts";
import { requireLoadedUser } from "@/lib/session";
import { loadSettingsAttention } from "@/lib/settings-attention";
import type { SettingsSectionId } from "@/lib/settings-sections";

export default async function SettingsLayout({ children }: { children: ReactNode }) {
  // Every page below checks again: a layout is not re-rendered on client navigation, so it
  // cannot be the only guard.
  const { user } = await requireLoadedUser();
  const isAdmin = user.role === "SERVER_ADMIN";
  const [attention, admin] = await Promise.all([
    loadSettingsAttention(user.id),
    isAdmin ? getAdminAttention() : Promise.resolve(null),
  ]);
  const hidden: SettingsSectionId[] = [];
  // Nothing a member can do there when the server has no bank sync; the admin still sees it,
  // with a pointer to where it is set up.
  if (!attention.plaidConfigured && !attention.hasBankConnections && !isAdmin) hidden.push("banks");

  return (
    <main className="mx-auto mb-4 mt-[max(1rem,env(safe-area-inset-top))] w-full max-w-6xl px-4 pb-8 pt-2 text-slate-100 sm:px-5 lg:my-6 lg:px-6">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3 lg:mb-6">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          <Link href="/settings" className="hover:text-white">
            Settings
          </Link>
        </h1>
        <Link
          href="/"
          className="inline-flex items-center justify-center rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200 transition hover:bg-slate-800"
        >
          Back to dashboard
        </Link>
      </div>
      {/* minmax(0,1fr): an auto column would grow to fit a wide table and push the page wider than the viewport. */}
      <div className="grid grid-cols-[minmax(0,1fr)] gap-8 lg:grid-cols-[13.5rem_minmax(0,1fr)]">
        <aside className="hidden min-w-0 lg:block">
          <SettingsNav hiddenSections={hidden} dots={attention.dots} adminBadges={admin ? admin.badges : null} />
        </aside>
        <div className="min-w-0">{children}</div>
      </div>
    </main>
  );
}
