"use client";

import { useEffect, useState } from "react";
// Loaded on every page so `beforeinstallprompt` is caught wherever it fires; the install
// button in Settings reads it later.
import "@/lib/pwa-install";

/**
 * Registers `public/sw.js` in production builds. Skipped under `next dev`: a caching
 * worker and Turbopack's hot reloading fight over the same requests.
 *
 * When a new worker takes over a page that already had one, offers a reload rather than
 * forcing it — the person may be halfway through a form.
 */
export function ServiceWorkerRegistrar() {
  const [updateReady, setUpdateReady] = useState(false);

  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;

    const hadController = Boolean(navigator.serviceWorker.controller);
    const onControllerChange = () => {
      if (hadController) setUpdateReady(true);
    };
    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);
    navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }).catch(() => {
      // Registration fails in some private modes; the app works the same without it.
    });
    return () => navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
  }, []);

  if (!updateReady) return null;
  return (
    <div
      role="status"
      className="fixed inset-x-3 bottom-[max(1rem,env(safe-area-inset-bottom))] z-[310] flex items-center justify-between gap-3 rounded-2xl border border-slate-700 bg-slate-900/98 px-4 py-3 text-sm text-slate-200 shadow-2xl sm:inset-x-auto sm:right-6 sm:w-[22rem]"
    >
      <span>A new version is available.</span>
      <span className="flex shrink-0 gap-2">
        <button
          type="button"
          onClick={() => setUpdateReady(false)}
          className="rounded-lg px-2 py-1 text-slate-400 hover:text-slate-200"
        >
          Later
        </button>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="rounded-lg bg-blue-500 px-3 py-1 font-medium text-white hover:bg-blue-400"
        >
          Reload
        </button>
      </span>
    </div>
  );
}
