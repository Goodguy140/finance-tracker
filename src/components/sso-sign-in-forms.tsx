"use client";

import { useEffect, useState } from "react";

const secondaryBtnClass =
  "touch-manipulation w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-3 text-sm font-medium text-slate-200 transition hover:border-slate-600 hover:bg-slate-800 sm:py-2.5";

const BOOTSTRAP_TIMEOUT_MS = 8000;
const PROVIDERS_CACHE_KEY = "auth.oauthProviders";

type OAuthProviderUi = {
  id: string;
  label: string;
  unavailableMessage: string;
};

const OAUTH_UI: OAuthProviderUi[] = [
  {
    id: "authentik",
    label: "Continue with SSO",
    unavailableMessage:
      "SSO (Authentik) is currently unavailable. Ask an admin to enable Authentik OIDC settings.",
  },
  {
    id: "google",
    label: "Continue with Google",
    unavailableMessage: "Google sign-in is currently unavailable. Ask an admin to enable Google OAuth settings.",
  },
];

function OAuthProviderButton({
  provider,
  callbackUrl,
  csrfToken,
}: {
  provider: OAuthProviderUi;
  callbackUrl: string;
  csrfToken: string | null;
}) {
  return (
    <form method="post" action={`/api/auth/signin/${provider.id}`} className="w-full">
      <input type="hidden" name="callbackUrl" value={callbackUrl} />
      <input type="hidden" name="csrfToken" value={csrfToken ?? ""} />
      <button
        type="submit"
        disabled={!csrfToken}
        className={`inline-flex w-full items-center justify-center ${secondaryBtnClass}`}
      >
        {provider.label}
      </button>
    </form>
  );
}

export function SsoSignInForms({ callbackUrl = "/" }: { callbackUrl?: string }) {
  const [availableIds, setAvailableIds] = useState<string[] | null>(null);
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
        const ids = OAUTH_UI.map((p) => p.id).filter((id) => Boolean(providers[id]));
        if (!cancelled) {
          setAvailableIds(ids);
          setCsrfToken(csrf.csrfToken ?? null);
          window.sessionStorage.setItem(PROVIDERS_CACHE_KEY, JSON.stringify(ids));
        }
      } catch {
        if (!cancelled) {
          const cached = window.sessionStorage.getItem(PROVIDERS_CACHE_KEY);
          try {
            const parsed = cached ? (JSON.parse(cached) as string[]) : [];
            setAvailableIds(parsed);
          } catch {
            setAvailableIds([]);
          }
        }
      } finally {
        clearTimeout(timeout);
      }
    };

    const refreshAuthBootstrap = () => {
      void loadAuthBootstrap();
    };

    const onPageShow = () => refreshAuthBootstrap();
    const onFocus = () => refreshAuthBootstrap();
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") refreshAuthBootstrap();
    };

    const cached = window.sessionStorage.getItem(PROVIDERS_CACHE_KEY);
    if (cached) {
      try {
        const parsed = JSON.parse(cached) as string[];
        window.setTimeout(() => setAvailableIds(parsed), 0);
      } catch {
        /* ignore */
      }
    }

    refreshAuthBootstrap();
    window.addEventListener("pageshow", onPageShow);
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      cancelled = true;
      window.removeEventListener("pageshow", onPageShow);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, []);

  if (availableIds === null) {
    return (
      <button type="button" disabled className={`inline-flex items-center justify-center opacity-60 ${secondaryBtnClass}`}>
        Checking sign-in options...
      </button>
    );
  }

  const configured = OAUTH_UI.filter((p) => availableIds.includes(p.id));
  if (configured.length === 0) {
    return (
      <p className="rounded-lg border border-slate-700/70 bg-slate-900/70 px-3 py-2 text-xs text-slate-300">
        Single sign-on is not configured. Use email and password, or ask an admin to enable Google or Authentik
        OAuth.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {configured.map((provider) => (
        <OAuthProviderButton
          key={provider.id}
          provider={provider}
          callbackUrl={callbackUrl}
          csrfToken={csrfToken}
        />
      ))}
    </div>
  );
}
