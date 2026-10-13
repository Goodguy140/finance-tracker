"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { ChartColumn, ChevronDown, LayoutDashboard, Lightbulb, LogOut, Settings, Shield, UserRound, type LucideIcon } from "lucide-react";
import { MOBILE_TAB_BAR_Z_CLASS } from "@/lib/mobile-z-index";
import { signOutOfDevice } from "@/lib/sign-out";

type Tab = { href: string; label: string; icon: LucideIcon; match: (pathname: string) => boolean };

const TABS: Tab[] = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard, match: (p) => p === "/" },
  { href: "/insights", label: "Insights", icon: Lightbulb, match: (p) => p.startsWith("/insights") },
  { href: "/reports", label: "Reports", icon: ChartColumn, match: (p) => p.startsWith("/reports") },
  { href: "/settings", label: "Settings", icon: Settings, match: (p) => p.startsWith("/settings") },
];

/** Insights and Reports both filter by `?tag=`; moving between them keeps the filter. */
function tabHref(tab: Tab, tagId: string | null | undefined) {
  if (!tagId || (tab.href !== "/insights" && tab.href !== "/reports")) return tab.href;
  return `${tab.href}?tag=${encodeURIComponent(tagId)}`;
}

/**
 * Bottom padding a page needs on phones so its last content clears the tab bar. The bar is
 * 3.5rem tall plus the home-indicator inset.
 */
export const APP_TAB_BAR_PAD_CLASS = "max-lg:pb-[calc(5rem+env(safe-area-inset-bottom))]";

function AccountMenu({ displayName, countryCode }: { displayName: string; countryCode: string }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  // Close on outside click and Escape, like any other menu.
  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const initial = displayName.trim().charAt(0).toUpperCase() || "?";
  const itemClass =
    "flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm text-slate-200 transition hover:bg-slate-800";

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-label="Account menu"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((v) => !v)}
        className="touch-manipulation flex min-h-9 items-center gap-2 rounded-full border border-slate-700/80 bg-slate-900 py-1 pl-1 pr-2 text-sm text-slate-200 transition hover:border-slate-600 hover:bg-slate-800"
      >
        <span
          className="flex h-7 w-7 items-center justify-center rounded-full bg-sky-500/20 text-xs font-semibold text-sky-200"
          aria-hidden
        >
          {initial}
        </span>
        <span className="hidden max-w-40 truncate sm:inline">{displayName}</span>
        <ChevronDown className="h-3.5 w-3.5 text-slate-400" aria-hidden />
      </button>
      {open ? (
        <div
          id={menuId}
          role="menu"
          aria-label="Account"
          className="absolute right-0 top-full z-[80] mt-2 w-56 rounded-xl border border-slate-700 bg-slate-900 p-1.5 shadow-2xl"
        >
          <div className="border-b border-slate-800 px-3 pb-2 pt-1.5">
            <p className="truncate text-sm font-medium text-slate-100">{displayName}</p>
            <p className="text-xs text-slate-400">Region: {countryCode}</p>
          </div>
          <div className="pt-1.5">
            <Link role="menuitem" href="/settings/profile" onClick={() => setOpen(false)} className={itemClass}>
              <UserRound className="h-4 w-4 text-slate-400" aria-hidden />
              Profile
            </Link>
            <Link role="menuitem" href="/settings/security" onClick={() => setOpen(false)} className={itemClass}>
              <Shield className="h-4 w-4 text-slate-400" aria-hidden />
              Security
            </Link>
            <button role="menuitem" type="button" onClick={() => void signOutOfDevice()} className={itemClass}>
              <LogOut className="h-4 w-4 text-slate-400" aria-hidden />
              Log out
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/**
 * The one app nav on every signed-in page: a top bar with the links and an account menu on
 * wide screens, and on phones the same links as a bottom tab bar. Pages that render it add
 * {@link APP_TAB_BAR_PAD_CLASS} so their content clears the bar.
 */
export function AppNav({
  displayName,
  countryCode,
  tagId,
}: {
  displayName: string;
  countryCode: string;
  /** The page's `?tag=` filter, carried to Insights and Reports. */
  tagId?: string | null;
}) {
  const pathname = usePathname() ?? "/";

  return (
    <>
      <header className="relative z-50 border-b border-slate-800/80 bg-slate-950 pt-[env(safe-area-inset-top)] text-slate-100">
        <div className="flex h-14 items-center gap-6 px-4 lg:px-6">
          <Link href="/" className="shrink-0 text-lg font-bold tracking-tight">
            Finance Tracker
          </Link>
          <nav aria-label="Main" className="hidden lg:block">
            <ul className="flex items-center gap-1">
              {TABS.map((tab) => {
                const active = tab.match(pathname);
                return (
                  <li key={tab.href}>
                    <Link
                      href={tabHref(tab, tagId)}
                      aria-current={active ? "page" : undefined}
                      className={`inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm transition ${
                        active ? "bg-slate-800 font-medium text-slate-50" : "text-slate-400 hover:bg-slate-900 hover:text-slate-100"
                      }`}
                    >
                      <tab.icon className="h-4 w-4" aria-hidden />
                      {tab.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>
          <div className="ml-auto">
            <AccountMenu displayName={displayName} countryCode={countryCode} />
          </div>
        </div>
      </header>

      {/* Outside the header: a fixed element inside an ancestor with a filter or transform
          is positioned against that ancestor, not the viewport. */}
      <nav
        aria-label="Main"
        className={`fixed inset-x-0 bottom-0 ${MOBILE_TAB_BAR_Z_CLASS} border-t border-slate-800 bg-slate-950 pb-[env(safe-area-inset-bottom)] lg:hidden`}
      >
        <ul className="grid h-14 grid-cols-4">
          {TABS.map((tab) => {
            const active = tab.match(pathname);
            return (
              <li key={tab.href} className="flex">
                <Link
                  href={tabHref(tab, tagId)}
                  aria-current={active ? "page" : undefined}
                  className={`touch-manipulation flex flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-medium transition ${
                    active ? "text-sky-300" : "text-slate-400 hover:text-slate-100"
                  }`}
                >
                  <tab.icon className="h-5 w-5" aria-hidden />
                  {tab.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </>
  );
}
