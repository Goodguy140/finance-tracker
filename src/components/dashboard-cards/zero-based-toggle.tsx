"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setZeroBasedBudgetingAction } from "@/app/actions";
import { isActionFailure } from "@/lib/action-result";

/** Switches the Safe to spend card between Safe to spend and zero-based "To assign"; saved on the user row. */
export function ZeroBasedToggle({ enabled }: { enabled: boolean }) {
  const router = useRouter();
  const [checked, setChecked] = useState(enabled);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const toggle = (next: boolean) => {
    setError(null);
    setChecked(next);
    startTransition(async () => {
      const formData = new FormData();
      formData.set("enabled", next ? "true" : "false");
      const result = await setZeroBasedBudgetingAction(formData);
      if (isActionFailure(result)) {
        setChecked(!next);
        setError(result.error);
        return;
      }
      router.refresh();
    });
  };

  return (
    <div className="mt-3 border-t border-slate-800 pt-2">
      <label className="inline-flex cursor-pointer items-center gap-2 text-xs text-slate-400">
        <input
          type="checkbox"
          className="h-4 w-4 rounded border-slate-600 bg-slate-900 text-blue-500 focus:ring-2 focus:ring-blue-500/40"
          checked={checked}
          disabled={pending}
          onChange={(e) => toggle(e.target.checked)}
          data-testid="zero-based-toggle"
        />
        Zero-based budgeting (give every dollar a job)
      </label>
      {error ? <p className="mt-1 text-xs text-red-300">{error}</p> : null}
    </div>
  );
}
