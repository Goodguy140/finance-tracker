"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  BarChart3,
  Cog,
  KeyRound,
  LayoutDashboard,
  Plug,
  ScrollText,
  Server,
  Users,
} from "lucide-react";
import type { AdminNavBadges } from "@/lib/admin-attention";

type NavItem = {
  href: string;
  label: string;
  icon: typeof Activity;
  badgeKey?: keyof AdminNavBadges;
};

export const ADMIN_NAV_ITEMS: NavItem[] = [
  { href: "/settings/admin", label: "Overview", icon: LayoutDashboard, badgeKey: "overview" },
  { href: "/settings/admin/analytics", label: "Analytics", icon: BarChart3 },
  { href: "/settings/admin/users", label: "Users", icon: Users, badgeKey: "users" },
  { href: "/settings/admin/authentication", label: "Authentication", icon: KeyRound, badgeKey: "authentication" },
  { href: "/settings/admin/integrations", label: "Integrations", icon: Plug, badgeKey: "integrations" },
  { href: "/settings/admin/operations", label: "Operations", icon: Cog },
  { href: "/settings/admin/audit", label: "Audit log", icon: ScrollText },
  { href: "/settings/admin/system", label: "System", icon: Server, badgeKey: "system" },
];

function isActive(pathname: string, href: string): boolean {
  if (href === "/settings/admin") return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * Vertical list beside the content on wide screens, a horizontally scrolling strip of
 * pills above it on narrow ones. A dot marks a section with something needing attention;
 * the Overview page says what.
 */
export function AdminNav({ badges }: { badges: AdminNavBadges }) {
  const pathname = usePathname() ?? "/settings/admin";

  return (
    <nav aria-label="Admin sections" className="lg:sticky lg:top-4">
      <ul className="-mx-4 flex gap-1 overflow-x-auto px-4 pb-1 lg:mx-0 lg:flex-col lg:overflow-visible lg:px-0 lg:pb-0">
        {ADMIN_NAV_ITEMS.map((item) => {
          const active = isActive(pathname, item.href);
          const badge = item.badgeKey ? badges[item.badgeKey] : null;
          const Icon = item.icon;
          return (
            <li key={item.href} className="shrink-0">
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                aria-describedby={badge ? `admin-nav-badge-${badge}` : undefined}
                className={`flex items-center gap-2 whitespace-nowrap rounded-lg px-3 py-2 text-sm transition-colors ${
                  active
                    ? "bg-slate-800 font-medium text-slate-50 ring-1 ring-slate-700"
                    : "text-slate-400 hover:bg-slate-900 hover:text-slate-100"
                }`}
              >
                <Icon className="h-4 w-4 shrink-0" aria-hidden />
                <span>{item.label}</span>
                {badge ? (
                  <span
                    className={`ml-auto inline-block h-2 w-2 rounded-full ${
                      badge === "bad" ? "bg-red-400" : "bg-amber-400"
                    }`}
                    aria-hidden
                  />
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
      {/* Described-by targets, so the dot is announced without changing the link's name. */}
      <span id="admin-nav-badge-bad" hidden>
        Needs attention
      </span>
      <span id="admin-nav-badge-warn" hidden>
        Has warnings
      </span>
    </nav>
  );
}
