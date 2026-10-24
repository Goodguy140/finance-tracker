import type { ReactNode } from "react";
import Link from "next/link";
import { AppNav, APP_TAB_BAR_PAD_CLASS } from "@/components/app-nav";
import { SettingsNav } from "@/components/settings/settings-nav";
import { IdentityConfirmationProvider } from "@/components/mfa/confirm-identity";
import { getAdminAttention } from "@/lib/admin-attention-facts";
import { identityPromptFor } from "@/lib/recent-identity";
import { requireLoadedUser } from "@/lib/session";
import { loadSettingsAttention } from "@/lib/settings-attention";
import type { SettingsSectionId } from "@/lib/settings-sections";

export default async function SettingsLayout({ children }: { children: ReactNode }) {
  // Every page below checks again: a layout is not re-rendered on client navigation, so it
  // cannot be the only guard.
  const loaded = await requireLoadedUser();
  const { user } = loaded;
  const isAdmin = user.role === "SERVER_ADMIN";
  const [attention, admin, identityPrompt] = await Promise.all([
    loadSettingsAttention(user.id),
    isAdmin ? getAdminAttention() : Promise.resolve(null),
    identityPromptFor(loaded),
  ]);
  const hidden: SettingsSectionId[] = [];
  // Nothing a member can do there when the server has no bank sync; the admin still sees it,
  // with a pointer to where it is set up.
  if (!attention.plaidConfigured && !attention.hasBankConnections && !isAdmin) hidden.push("banks");

  return (
    <>
    <AppNav displayName={user.displayName} countryCode={user.countryCode} />
    <main className={`mx-auto my-4 w-full max-w-6xl px-4 pb-8 pt-2 text-slate-100 sm:px-5 lg:my-6 lg:px-6 ${APP_TAB_BAR_PAD_CLASS}`}>
      <h1 className="mb-5 text-2xl font-semibold tracking-tight sm:text-3xl lg:mb-6">
        <Link href="/settings" className="hover:text-white">
          Settings
        </Link>
      </h1>
      {/* minmax(0,1fr): an auto column would grow to fit a wide table and push the page wider than the viewport. */}
      <div className="grid grid-cols-[minmax(0,1fr)] gap-8 lg:grid-cols-[13.5rem_minmax(0,1fr)]">
        <aside className="hidden min-w-0 lg:block">
          <SettingsNav hiddenSections={hidden} dots={attention.dots} adminBadges={admin ? admin.badges : null} />
        </aside>
        <div className="min-w-0">
          <IdentityConfirmationProvider prompt={identityPrompt}>{children}</IdentityConfirmationProvider>
        </div>
      </div>
    </main>
    </>
  );
}
