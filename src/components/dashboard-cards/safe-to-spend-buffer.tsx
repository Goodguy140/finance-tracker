"use client";

import { useId, useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { setSafeToSpendBufferAction } from "@/app/actions";
import { isActionFailure } from "@/lib/action-result";
import { SAFE_TO_SPEND_BUFFER_MAX_DAYS } from "@/lib/safe-to-spend";

/**
 * Safe to spend's buffer, set on the card: how many days ahead it also holds back bills that fall
 * next month. Saved on the user row, so the phone app and the email digest use the same number.
 */
export function SafeToSpendBufferSetting({ bufferDays }: { bufferDays: number | null }) {
  const router = useRouter();
  // The card renders in both the phone and the desktop layout until the page knows which it is.
  const inputId = useId();
  const saved = bufferDays === null ? "" : String(bufferDays);
  const [value, setValue] = useState(saved);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const changed = value.trim() !== saved;

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!changed) return;
    setError(null);
    startTransition(async () => {
      const formData = new FormData();
      formData.set("days", value.trim());
      const result = await setSafeToSpendBufferAction(formData);
      if (isActionFailure(result)) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  };

  return (
    <form noValidate onSubmit={submit} className="mt-3 border-t border-slate-800 pt-2" data-testid="safe-to-spend-buffer">
      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
        <label htmlFor={inputId}>Bill buffer</label>
        <input
          id={inputId}
          name="days"
          type="number"
          inputMode="numeric"
          min={1}
          max={SAFE_TO_SPEND_BUFFER_MAX_DAYS}
          step={1}
          placeholder="Off"
          value={value}
          disabled={pending}
          onChange={(e) => setValue(e.target.value)}
          className="h-8 w-16 rounded-lg border border-slate-700 bg-slate-900 px-2 text-sm tabular-nums text-slate-100 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
        />
        <span>days</span>
        <button
          type="submit"
          disabled={pending || !changed}
          className="rounded-lg border border-slate-700 px-2 py-1 text-xs text-slate-200 hover:bg-slate-800 disabled:cursor-default disabled:opacity-50 disabled:hover:bg-transparent"
        >
          {pending ? "Saving…" : "Save"}
        </button>
      </div>
      <p className="mt-1 text-[11px] leading-snug text-slate-500">
        Also holds back next month&apos;s bills due within this many days of today, so this month&apos;s money is not
        spent on them. Bills due by month end always count. Leave it empty for none.
      </p>
      {error ? <p className="mt-1 text-xs text-red-300">{error}</p> : null}
    </form>
  );
}
