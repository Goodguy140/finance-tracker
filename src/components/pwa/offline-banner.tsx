"use client";

import { WifiOff } from "lucide-react";
import { isSavedCopy, useOnlineStatus } from "@/lib/use-online-status";

/**
 * When the dashboard was rendered, from `data-rendered-at` on its `<main>`
 * (`src/app/page.tsx`); the service worker serves a cached copy back unchanged, so this is
 * how old the figures on screen are. Only read once offline, which is never during
 * hydration (`useOnlineStatus` reports online on that pass).
 */
function renderedAtLabel(): string | null {
  const raw = document.querySelector<HTMLElement>("[data-rendered-at]")?.dataset.renderedAt;
  const date = raw ? new Date(raw) : null;
  if (!date || Number.isNaN(date.getTime())) return null;
  return date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export function OfflineBanner() {
  const online = useOnlineStatus();
  if (online) return null;

  const renderedAt = renderedAtLabel();
  return (
    <div
      role="status"
      data-testid="offline-banner"
      className="fixed inset-x-0 top-0 z-[320] flex items-center justify-center gap-2 border-b border-amber-800/70 bg-amber-950/95 px-4 pb-2 pt-[max(0.5rem,env(safe-area-inset-top))] text-center text-xs text-amber-100 shadow-lg backdrop-blur"
    >
      <WifiOff className="size-3.5 shrink-0" aria-hidden />
      <span>
        Offline{renderedAt ? ` · showing data from ${renderedAt}` : ""} · changes are disabled
      </span>
      {isSavedCopy() ? (
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="ml-1 shrink-0 rounded-md border border-amber-700/70 px-2 py-0.5 font-medium hover:bg-amber-900/60"
        >
          Reload
        </button>
      ) : null}
    </div>
  );
}
