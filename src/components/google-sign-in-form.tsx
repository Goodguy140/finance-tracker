"use client";

import { useEffect, useState } from "react";
import { getCsrfToken } from "next-auth/react";

const secondaryBtnClass =
  "touch-manipulation w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-3 text-sm font-medium text-slate-200 transition hover:border-slate-600 hover:bg-slate-800 sm:py-2.5";

/**
 * Uses a real POST form (no `json: true`) so NextAuth responds with HTTP 302 to
 * Google. That full-document navigation works reliably on iOS Safari; the default
 * `signIn()` fetch + `location.href` flow often breaks after async awaits.
 */
export function GoogleSignInForm({ callbackUrl = "/" }: { callbackUrl?: string }) {
  const [csrfToken, setCsrfToken] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const token = await getCsrfToken();
        if (!cancelled && token) setCsrfToken(token);
      } catch {
        if (!cancelled) setCsrfToken(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <form method="post" action="/api/auth/signin/google" className="w-full">
      <input type="hidden" name="csrfToken" value={csrfToken ?? ""} />
      <input type="hidden" name="callbackUrl" value={callbackUrl} />
      <button type="submit" disabled={!csrfToken} className={secondaryBtnClass}>
        {csrfToken ? "Continue with Google" : "Preparing Google sign-in…"}
      </button>
    </form>
  );
}
