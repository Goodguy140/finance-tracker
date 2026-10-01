"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { refreshLinkedAccountsAction } from "@/app/actions/plaid";
import { isActionFailure } from "@/lib/action-result";
import type { LogRefreshResult } from "@/lib/plaid/log-refresh";
import { canReachServer } from "@/lib/use-online-status";
import { OFFLINE_WRITE_MESSAGE } from "@/components/server-action-form";

type Status = { tone: LogRefreshResult["tone"] | "error"; message: string };

/** Long enough to read the sentence, short enough that it is not mistaken for current state. */
const STATUS_VISIBLE_MS = 10_000;

const TONE_CLASS: Record<Status["tone"], string> = {
  success: "text-emerald-300",
  neutral: "text-slate-400",
  warning: "text-amber-300",
  error: "text-red-300",
};

function RefreshIcon({ spinning }: { spinning: boolean }) {
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden="true"
      className={`h-3.5 w-3.5 ${spinning ? "animate-spin motion-reduce:animate-none" : ""}`}
      fill="none"
    >
      <path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path
        d="M13.5 2.5V5H11"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * Pulls new transactions from the connected banks without leaving the log.
 *
 * Spins while the banks are checked, then says what came of it next to the icon. Nothing it
 * finds is posted — rows land in the review queue above the log. See `describeLogRefresh`
 * for which banks it checks.
 */
export function RefreshLinkedAccountsButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState<Status | null>(null);

  useEffect(() => {
    if (!status) return;
    const timer = window.setTimeout(() => setStatus(null), STATUS_VISIBLE_MS);
    return () => window.clearTimeout(timer);
  }, [status]);

  function refresh() {
    setStatus(null);
    if (!canReachServer()) {
      setStatus({ tone: "error", message: OFFLINE_WRITE_MESSAGE });
      return;
    }
    startTransition(async () => {
      try {
        const result = await refreshLinkedAccountsAction();
        if (isActionFailure(result)) {
          setStatus({ tone: "error", message: result.error });
          return;
        }
        setStatus({ tone: result.tone, message: result.message });
        router.refresh();
      } catch {
        setStatus({ tone: "error", message: "Could not refresh your banks. Please try again." });
      }
    });
  }

  return (
    <div className="flex min-w-0 items-center gap-2">
      <button
        type="button"
        onClick={refresh}
        disabled={pending}
        aria-busy={pending}
        title="Refresh linked accounts — new transactions arrive in the review queue"
        aria-label="Refresh linked accounts"
        className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-slate-700 text-slate-400 transition hover:border-blue-500/40 hover:text-blue-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 disabled:cursor-wait disabled:text-blue-200 touch-manipulation"
      >
        <RefreshIcon spinning={pending} />
      </button>
      <p role="status" aria-live="polite" className={`min-w-0 text-xs ${status ? TONE_CLASS[status.tone] : "text-slate-500"}`}>
        {pending ? "Checking your banks…" : (status?.message ?? "")}
      </p>
    </div>
  );
}
