"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Search } from "lucide-react";
import { ADMIN_NAV_ITEMS } from "@/components/admin/admin-nav";
import type { AdminNavBadges } from "@/lib/admin-attention";
import {
  matchSettingsSection,
  SETTINGS_GROUPS,
  SETTINGS_SECTIONS,
  settingsHref,
  type SettingsSectionId,
} from "@/lib/settings-sections";

export type SettingsNavProps = {
  hiddenSections: SettingsSectionId[];
  dots: Partial<Record<SettingsSectionId, "warn" | "bad">>;
  /** Null for anyone who is not a server admin; the Server group is then left out. */
  adminBadges: AdminNavBadges | null;
};

function Dot({ tone }: { tone: "warn" | "bad" }) {
  return (
    <span
      className={`ml-auto inline-block h-2 w-2 shrink-0 rounded-full ${tone === "bad" ? "bg-red-400" : "bg-amber-400"}`}
      aria-hidden
    />
  );
}

const ADMIN_SEARCH_TEXT = ["server admin", ...ADMIN_NAV_ITEMS.map((item) => item.label.toLowerCase())].join(" ");

const linkClass = (active: boolean) =>
  `flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm transition-colors ${
    active ? "bg-slate-800 font-medium text-slate-50" : "text-slate-400 hover:bg-slate-900 hover:text-slate-100"
  }`;

/**
 * The sidebar on wide screens. Phones get the same list as the Settings home page instead,
 * since a sidebar there either crowds the page or hides behind a menu button.
 */
export function SettingsNav({ hiddenSections, dots, adminBadges }: SettingsNavProps) {
  const pathname = usePathname() ?? "/settings";
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  // "/" jumps to the search box, as in GitHub and Linear, unless the person is typing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (target && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))) return;
      e.preventDefault();
      searchRef.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const visible = SETTINGS_SECTIONS.filter((s) => !hiddenSections.includes(s.id) && matchSettingsSection(s, query));
  // One entry for the whole admin area; its own pages have their own strip of links.
  const showAdmin = adminBadges !== null && (!query.trim() || ADMIN_SEARCH_TEXT.includes(query.trim().toLowerCase()));
  const adminActive = pathname === "/settings/admin" || pathname.startsWith("/settings/admin/");

  return (
    <nav aria-label="Settings sections" className="space-y-4 lg:sticky lg:top-4">
      <label className="relative block">
        <span className="sr-only">Search settings</span>
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" aria-hidden />
        <input
          ref={searchRef}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") setQuery("");
          }}
          placeholder="Search settings"
          className="w-full rounded-lg border border-slate-800 bg-slate-950/60 py-1.5 pl-8 pr-8 text-sm text-slate-100 placeholder:text-slate-500 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-500/20"
        />
        <kbd className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 rounded border border-slate-700 px-1 font-mono text-[10px] text-slate-500">
          /
        </kbd>
      </label>

      {SETTINGS_GROUPS.map((group) => {
        const sections = visible.filter((s) => s.group === group.id);
        if (sections.length === 0) return null;
        return (
          <div key={group.id} className="space-y-0.5">
            <p className="px-2.5 pb-1 text-[11px] font-medium uppercase tracking-wider text-slate-500">{group.label}</p>
            <ul className="space-y-0.5">
              {sections.map((section) => {
                const href = settingsHref(section.id);
                const active = pathname === href || pathname.startsWith(`${href}/`);
                const dot = dots[section.id];
                return (
                  <li key={section.id}>
                    <Link
                      href={href}
                      aria-current={active ? "page" : undefined}
                      aria-describedby={dot ? `settings-nav-dot-${dot}` : undefined}
                      className={linkClass(active)}
                    >
                      <span className="truncate">{section.label}</span>
                      {dot ? <Dot tone={dot} /> : null}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}

      {showAdmin ? (
        <div className="space-y-0.5">
          <p className="px-2.5 pb-1 text-[11px] font-medium uppercase tracking-wider text-slate-500">Server</p>
          <ul>
            <li>
              <Link
                href="/settings/admin"
                aria-current={adminActive ? "page" : undefined}
                aria-describedby={adminBadges?.overview ? `settings-nav-dot-${adminBadges.overview}` : undefined}
                className={linkClass(adminActive)}
              >
                <span className="truncate">Server admin</span>
                {adminBadges?.overview ? <Dot tone={adminBadges.overview} /> : null}
              </Link>
            </li>
          </ul>
        </div>
      ) : null}

      {visible.length === 0 && !showAdmin ? (
        <p className="px-2.5 text-sm text-slate-500">No settings match &ldquo;{query}&rdquo;.</p>
      ) : null}

      {/* Described-by targets, so a dot is announced without changing the link's name. */}
      <span id="settings-nav-dot-bad" hidden>
        Needs attention
      </span>
      <span id="settings-nav-dot-warn" hidden>
        Has warnings
      </span>
    </nav>
  );
}
