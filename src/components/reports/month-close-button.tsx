"use client";

import { useState, useTransition } from "react";
import { CheckCircle2 } from "lucide-react";
import { closeMonthAction, reopenMonthAction } from "@/app/actions/month-close";
import { isActionFailure } from "@/lib/action-result";

export function MonthCloseButton({ ym, closedDisplay }: { ym: string; closedDisplay: string | null }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const run = (action: typeof closeMonthAction) =>
    startTransition(async () => {
      const formData = new FormData();
      formData.set("ym", ym);
      const result = await action(formData);
      setError(isActionFailure(result) ? result.error : null);
    });
  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="month-close">
      {closedDisplay ? (
        <>
          <span className="inline-flex items-center gap-1.5 text-sm text-emerald-200">
            <CheckCircle2 className="h-4 w-4" aria-hidden />
            Closed {closedDisplay}
          </span>
          <button
            type="button"
            disabled={pending}
            onClick={() => run(reopenMonthAction)}
            className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-sm text-slate-200 transition hover:bg-slate-800 disabled:opacity-60"
          >
            Reopen
          </button>
        </>
      ) : (
        <button
          type="button"
          disabled={pending}
          onClick={() => run(closeMonthAction)}
          className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-emerald-500 disabled:opacity-60"
        >
          Mark month closed
        </button>
      )}
      {error ? (
        <p role="alert" className="text-sm text-red-300">
          {error}
        </p>
      ) : null}
    </div>
  );
}
