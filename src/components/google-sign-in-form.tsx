 "use client";

import { useEffect, useState } from "react";

const secondaryBtnClass =
  "touch-manipulation w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-3 text-sm font-medium text-slate-200 transition hover:border-slate-600 hover:bg-slate-800 sm:py-2.5";

const BOOTSTRAP_TIMEOUT_MS = 8000;
const GOOGLE_AVAILABLE_CACHE_KEY = "auth.googleAvailable";

export function GoogleSignInForm({ callbackUrl = "/" }: { callbackUrl?: string }) {
  const [googleAvailable, setGoogleAvailable] = useState<boolean | null>(null);
  const [csrfToken, setCsrfToken] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const loadAuthBootstrap = async () => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), BOOTSTRAP_TIMEOUT_MS);
      try {
        const [providersRes, csrfRes] = await Promise.all([
          fetch("/api/auth/providers", { cache: "no-store", signal: controller.signal }),
          fetch("/api/auth/csrf", { cache: "no-store", signal: controller.signal }),
        ]);
        if (!providersRes.ok || !csrfRes.ok) throw new Error("auth bootstrap failed");
        const providers = (await providersRes.json()) as Record<string, unknown>;
        const csrf = (await csrfRes.json()) as { csrfToken?: string };
        const available = Boolean(providers.google);
        if (!cancelled) {
          setGoogleAvailable(available);
          setCsrfToken(csrf.csrfToken ?? null);
          window.sessionStorage.setItem(GOOGLE_AVAILABLE_CACHE_KEY, available ? "true" : "false");
        }
      } catch {
        if (!cancelled) {
          setGoogleAvailable((prev) => {
            const next = prev ?? false;
            window.sessionStorage.setItem(GOOGLE_AVAILABLE_CACHE_KEY, next ? "true" : "false");
            return next;
          });
          setCsrfToken((prev) => prev);
        }
      } finally {
        clearTimeout(timeout);
      }
    };

    const refreshAuthBootstrap = () => {
      void loadAuthBootstrap();
    };

    const onPageShow = () => {
      // Browsers can restore login pages from BFCache after back navigation.
      // Force a fresh auth bootstrap so the button does not stay stuck loading.
      refreshAuthBootstrap();
    };
    const onFocus = () => {
      refreshAuthBootstrap();
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") refreshAuthBootstrap();
    };

    const cached = window.sessionStorage.getItem(GOOGLE_AVAILABLE_CACHE_KEY);
    const cachedValue = cached === "true" ? true : cached === "false" ? false : null;
    const cachedTimer =
      cachedValue === null ? null : window.setTimeout(() => setGoogleAvailable(cachedValue), 0);

    refreshAuthBootstrap();
    window.addEventListener("pageshow", onPageShow);
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      cancelled = true;
      window.removeEventListener("pageshow", onPageShow);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      if (cachedTimer !== null) window.clearTimeout(cachedTimer);
    };
  }, []);

  if (googleAvailable === null) {
    return (
      <button type="button" disabled className={`inline-flex items-center justify-center opacity-60 ${secondaryBtnClass}`}>
        Checking Google sign-in...
      </button>
    );
  }

  if (!googleAvailable) {
    return (
      <p className="rounded-lg border border-slate-700/70 bg-slate-900/70 px-3 py-2 text-xs text-slate-300">
        Google sign-in is currently unavailable. Ask an admin to enable Google OAuth settings.
      </p>
    );
  }

  return (
    <form method="post" action="/api/auth/signin/google" className="w-full">
      <input type="hidden" name="callbackUrl" value={callbackUrl} />
      <input type="hidden" name="csrfToken" value={csrfToken ?? ""} />
      <button
        type="submit"
        disabled={!csrfToken}
        className={`inline-flex w-full items-center justify-center ${secondaryBtnClass}`}
      >
        Continue with Google
      </button>
    </form>
  );
}
