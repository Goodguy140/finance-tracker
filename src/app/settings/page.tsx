import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { LegacyHashRedirect } from "@/components/settings/legacy-hash-redirect";
import { getAdminAttention } from "@/lib/admin-attention-facts";
import { requireLoadedUser } from "@/lib/session";
import { loadSettingsAttention } from "@/lib/settings-attention";
import { SETTINGS_GROUPS, SETTINGS_SECTIONS, settingsHref } from "@/lib/settings-sections";

export const dynamic = "force-dynamic";

/**
 * The Settings home: what needs attention first, then every section. On a phone this list
 * is the navigation; on a wide screen it sits beside the same list in the sidebar, as an
 * index with one line about each page.
 */
export default async function SettingsHomePage() {
  const { user } = await requireLoadedUser();
  const isAdmin = user.role === "SERVER_ADMIN";
  const [attention, admin] = await Promise.all([
    loadSettingsAttention(user.id),
    isAdmin ? getAdminAttention() : Promise.resolve(null),
  ]);
  const hideBanks = !attention.plaidConfigured && !attention.hasBankConnections && !isAdmin;
  const sections = SETTINGS_SECTIONS.filter((s) => !(hideBanks && s.id === "banks"));

  return (
    <div className="space-y-6">
      <LegacyHashRedirect />

      {attention.items.length > 0 ? (
        <section aria-label="Needs attention" className="space-y-2">
          <h2 className="text-xs font-medium uppercase tracking-wider text-slate-500">Needs attention</h2>
          <ul className="space-y-2">
            {attention.items.map((item, i) => (
              <li key={`${item.section}-${i}`}>
                <Link
                  href={settingsHref(item.section)}
                  className={`flex items-center gap-3 rounded-xl border px-4 py-3 transition ${
                    item.tone === "bad"
                      ? "border-red-500/35 bg-red-950/25 hover:bg-red-950/40"
                      : "border-amber-500/30 bg-amber-950/20 hover:bg-amber-950/35"
                  }`}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium text-slate-100">{item.title}</span>
                    <span className="block text-sm text-slate-400">{item.message}</span>
                  </span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-slate-500" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {SETTINGS_GROUPS.map((group) => (
        <section key={group.id} aria-label={group.label} className="space-y-2">
          <h2 className="text-xs font-medium uppercase tracking-wider text-slate-500">{group.label}</h2>
          <ul className="divide-y divide-slate-800 overflow-hidden rounded-xl border border-slate-800 bg-slate-900/50">
            {sections
              .filter((s) => s.group === group.id)
              .map((section) => {
                const dot = attention.dots[section.id];
                return (
                  <li key={section.id}>
                    <Link
                      href={settingsHref(section.id)}
                      className="flex items-center gap-3 px-4 py-3 transition hover:bg-slate-900"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium text-slate-100">{section.label}</span>
                        <span className="block truncate text-xs text-slate-500">{section.summary}</span>
                      </span>
                      {dot ? (
                        <span
                          className={`h-2 w-2 shrink-0 rounded-full ${dot === "bad" ? "bg-red-400" : "bg-amber-400"}`}
                          aria-label={dot === "bad" ? "Needs attention" : "Has warnings"}
                        />
                      ) : null}
                      <ChevronRight className="h-4 w-4 shrink-0 text-slate-500" aria-hidden />
                    </Link>
                  </li>
                );
              })}
          </ul>
        </section>
      ))}

      {admin ? (
        <section aria-label="Server" className="space-y-2">
          <h2 className="text-xs font-medium uppercase tracking-wider text-slate-500">Server</h2>
          <Link
            href="/settings/admin"
            className="flex items-center gap-3 rounded-xl border border-slate-800 bg-slate-900/50 px-4 py-3 transition hover:bg-slate-900"
          >
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium text-slate-100">Server admin</span>
              <span className="block truncate text-xs text-slate-500">Users, sign-in, integrations and system health.</span>
            </span>
            {admin.badges.overview ? (
              <span
                className={`h-2 w-2 shrink-0 rounded-full ${admin.badges.overview === "bad" ? "bg-red-400" : "bg-amber-400"}`}
                aria-label="Needs attention"
              />
            ) : null}
            <ChevronRight className="h-4 w-4 shrink-0 text-slate-500" aria-hidden />
          </Link>
        </section>
      ) : null}
    </div>
  );
}
