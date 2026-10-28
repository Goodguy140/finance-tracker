"use client";

import { useState, useTransition } from "react";
import { setBillRemindersAction } from "@/app/actions";
import { isActionFailure } from "@/lib/action-result";

const CHOICES: Array<{ value: string; label: string }> = [
  { value: "OFF", label: "Off" },
  { value: "1", label: "The day before" },
  { value: "3", label: "3 days before" },
  { value: "7", label: "A week before" },
];

/** Settings → Notifications: an email (and phone notification) a few days before each recurring bill is due. */
export function BillReminderPreferences({
  emailConfigured,
  phoneReady,
  days,
}: {
  emailConfigured: boolean;
  phoneReady: boolean;
  days: number | null;
}) {
  const [value, setValue] = useState(days === null ? "OFF" : String(days));
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const choose = (next: string) => {
    const previous = value;
    setValue(next);
    setError(null);
    startTransition(async () => {
      const formData = new FormData();
      formData.set("days", next);
      const result = await setBillRemindersAction(formData);
      if (isActionFailure(result)) {
        setValue(previous);
        setError(result.error);
      }
    });
  };

  return (
    <section
      aria-label="Bill reminders"
      className="space-y-3 rounded-xl border border-slate-800 bg-slate-900/50 p-4 sm:p-5"
    >
      <div className="space-y-1">
        <h3 className="text-base font-semibold text-slate-100">Bill reminders</h3>
        <p className="text-sm text-slate-400">
          A reminder before a recurring bill or transfer is due (by email, and on phones set up below), listing what is coming and from which account. Each
          bill is reminded once; set bills up on the dashboard&apos;s Recurring card.
        </p>
      </div>
      {emailConfigured ? null : (
        <p className="text-xs text-amber-200">
          Email needs SMTP_HOST, SMTP_USER, SMTP_PASS, and SMTP_FROM on the server.{" "}
          {phoneReady ? "These go to your phone instead." : "Or turn on Phone notifications below to get these there."}
        </p>
      )}
      <fieldset className="space-y-2" disabled={(!emailConfigured && !phoneReady) || pending}>
        <legend className="sr-only">When to remind you</legend>
        {CHOICES.map((choice) => (
          <label key={choice.value} className="flex cursor-pointer items-center gap-3">
            <input
              type="radio"
              name="bill-reminder-days"
              value={choice.value}
              checked={value === choice.value}
              onChange={() => choose(choice.value)}
              className="h-4 w-4 border-slate-600 bg-slate-900 text-blue-500"
            />
            <span className="text-sm font-medium text-slate-200">{choice.label}</span>
          </label>
        ))}
      </fieldset>
      {error ? (
        <p role="status" className="text-xs text-red-300">
          {error}
        </p>
      ) : null}
    </section>
  );
}
