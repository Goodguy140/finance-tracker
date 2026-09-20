"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Opens Plaid Link.
 *
 * The Link script is injected on demand rather than via `next/script` in the layout, so a
 * third-party script only loads for the person who actually opened the bank panel — and
 * the CSP allowances it needs are only exercised there. `react-plaid-link` is deliberately
 * not a dependency: it is a thin wrapper over exactly this, and this repo has been
 * disciplined enough that `lucide-react` is installed and still unused.
 */

const LINK_SCRIPT_SRC = "https://cdn.plaid.com/link/v2/stable/link-initialize.js";

type PlaidHandler = {
  open: () => void;
  exit: (opts?: { force?: boolean }) => void;
  destroy: () => void;
};

type PlaidLinkOnSuccessMetadata = {
  institution?: { name?: string | null } | null;
};

type PlaidGlobal = {
  create: (config: {
    token: string;
    onSuccess: (publicToken: string, metadata: PlaidLinkOnSuccessMetadata) => void;
    onExit: (error: { display_message?: string | null; error_message?: string | null } | null) => void;
    onEvent?: (eventName: string) => void;
  }) => PlaidHandler;
};

declare global {
  interface Window {
    Plaid?: PlaidGlobal;
  }
}

let scriptPromise: Promise<void> | null = null;

/** Loads the Link script once per page, shared by every button on it. */
function loadPlaidScript(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (window.Plaid) return Promise.resolve();
  if (scriptPromise) return scriptPromise;

  scriptPromise = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${LINK_SCRIPT_SRC}"]`);
    if (existing) {
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () => reject(new Error("load failed")));
      return;
    }
    const script = document.createElement("script");
    script.src = LINK_SCRIPT_SRC;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      // Let a later attempt retry rather than caching the failure forever.
      scriptPromise = null;
      reject(new Error("load failed"));
    };
    document.head.appendChild(script);
  });
  return scriptPromise;
}

export type PlaidLinkLauncherProps = {
  /** Link token from the server. Null until one has been requested. */
  linkToken: string | null;
  onSuccess: (publicToken: string, institutionName: string | null) => void;
  onExit?: (message: string | null) => void;
};

/**
 * Opens Link as soon as a token arrives, then clears the handler.
 *
 * Returns nothing visible: the caller owns the button, because the token has to be minted
 * (behind a passkey prompt) before Link can be opened at all.
 */
export function usePlaidLink({ linkToken, onSuccess, onExit }: PlaidLinkLauncherProps) {
  const [scriptError, setScriptError] = useState<string | null>(null);
  const handlerRef = useRef<PlaidHandler | null>(null);
  const openedForToken = useRef<string | null>(null);

  // Kept in refs so a re-render between minting the token and Link calling back cannot
  // invoke a stale closure.
  const onSuccessRef = useRef(onSuccess);
  const onExitRef = useRef(onExit);
  useEffect(() => {
    onSuccessRef.current = onSuccess;
    onExitRef.current = onExit;
  }, [onSuccess, onExit]);

  useEffect(() => {
    if (!linkToken) return;
    if (openedForToken.current === linkToken) return;
    openedForToken.current = linkToken;

    let cancelled = false;
    setScriptError(null);

    loadPlaidScript()
      .then(() => {
        if (cancelled || !window.Plaid) return;
        handlerRef.current?.destroy();
        const handler = window.Plaid.create({
          token: linkToken,
          onSuccess: (publicToken, metadata) => {
            onSuccessRef.current(publicToken, metadata?.institution?.name ?? null);
          },
          onExit: (error) => {
            // A user closing Link is not an error and must not surface as one.
            const message = error?.display_message ?? error?.error_message ?? null;
            onExitRef.current?.(message);
          },
        });
        handlerRef.current = handler;
        handler.open();
      })
      .catch(() => {
        if (cancelled) return;
        setScriptError(
          "Could not load Plaid Link. Check your network connection, or any content blocker that might be blocking cdn.plaid.com.",
        );
      });

    return () => {
      cancelled = true;
    };
  }, [linkToken]);

  useEffect(() => {
    return () => {
      handlerRef.current?.destroy();
      handlerRef.current = null;
    };
  }, []);

  return { scriptError };
}
