"use client";

import { useState, useTransition } from "react";
import { setProjectionIncludesTransfersAction } from "@/app/actions";
import { isActionFailure } from "@/lib/action-result";

/** The projected balances "Include transfers" choice, saved on the user row. */
export function ProjectionTransfersToggle({ enabled }: { enabled: boolean }) {
  const [checked, setChecked] = useState(enabled);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const toggle = (next: boolean) => {
    setError(null);
    setChecked(next);
    startTransition(async () => {
      const formData = new FormData();
      formData.set("enabled", next ? "true" : "false");
      const result = await setProjectionIncludesTransfersAction(formData);
      if (isActionFailure(result)) {
        setChecked(!next);
        setError(result.error);
      }
    });
  };

  return (
    <div className="mb-3">
      <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-slate-300">
        <input
          type="checkbox"
          className="h-4 w-4 rounded border-slate-600 bg-slate-900 text-blue-500 focus:ring-2 focus:ring-blue-500/40"
          checked={checked}
          disabled={pending}
          onChange={(e) => toggle(e.target.checked)}
          data-testid="projected-include-transfers"
        />
        Include recurring transfers
      </label>
      {error ? <p className="mt-1 text-xs text-red-300">{error}</p> : null}
    </div>
  );
}
