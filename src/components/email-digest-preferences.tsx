"use client";

import { useState, useTransition } from "react";
import { sendEmailDigestPreviewAction, setEmailDigestAction } from "@/app/actions";
import { isActionFailure } from "@/lib/action-result";

type Frequency = "OFF" | "WEEKLY" | "MONTHLY";

const CHOICES: Array<{ value: Frequency; label: string; hint: string }> = [
  { value: "OFF", label: "Off", hint: "" },
  { value: "WEEKLY", label: "Weekly", hint: "Monday morning, covering Monday to Sunday." },
  { value: "MONTHLY", label: "Monthly", hint: "The morning of the 1st, covering the month before." },
];

/** Settings → Notifications: the emailed spending digest. */
export function EmailDigestPreferences({ emailConfigured, frequency }: { emailConfigured: boolean; frequency: Frequency }) {
  const [value, setValue] = useState(frequency);
  const [message, setMessage] = useState<{ error: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const choose = (next: Frequency) => {
    const previous = value;
    setValue(next);
    setMessage(null);
    startTransition(async () => {
      const formData = new FormData();
      formData.set("frequency", next);
      const result = await setEmailDigestAction(formData);
      if (isActionFailure(result)) {
        setValue(previous);
        setMessage({ error: true, text: result.error });
      }
    });
  };

  const preview = () => {
    setMessage(null);
    startTransition(async () => {
      const result = await sendEmailDigestPreviewAction(new FormData());
      setMessage(
        isActionFailure(result)
          ? { error: true, text: result.error }
          : { error: false, text: "Sent. Check your inbox for the latest digest." },
      );
    });
  };

  return (
    <section
      aria-label="Email digest"
      className="space-y-3 rounded-xl border border-slate-800 bg-slate-900/50 p-4 sm:p-5"
    >
      <div className="space-y-1">
        <h3 className="text-base font-semibold text-slate-100">Email digest</h3>
        <p className="text-sm text-slate-400">
          A short summary in your inbox: what you spent and received, where it went, budgets to watch, bills
          coming up and bank transactions waiting for review. Nothing is sent for a period with nothing in it.
        </p>
      </div>
      {emailConfigured ? null : (
        <p className="text-xs text-amber-200">Requires SMTP_HOST, SMTP_USER, SMTP_PASS, and SMTP_FROM on the server.</p>
      )}
      <fieldset className="space-y-2" disabled={!emailConfigured || pending}>
        <legend className="sr-only">How often</legend>
        {CHOICES.map((choice) => (
          <label key={choice.value} className="flex cursor-pointer items-start gap-3">
            <input
              type="radio"
              name="digest-frequency"
              value={choice.value}
              checked={value === choice.value}
              onChange={() => choose(choice.value)}
              className="mt-0.5 h-4 w-4 border-slate-600 bg-slate-900 text-blue-500"
            />
            <span className="text-sm text-slate-300">
              <span className="font-medium text-slate-200">{choice.label}</span>
              {choice.hint ? <span className="mt-0.5 block text-xs text-slate-500">{choice.hint}</span> : null}
            </span>
          </label>
        ))}
      </fieldset>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={preview}
          disabled={!emailConfigured || pending}
          className="rounded-lg border border-slate-700 bg-slate-800/70 px-3 py-1.5 text-sm text-slate-200 transition hover:bg-slate-800 disabled:opacity-50"
        >
          Send me one now
        </button>
        {message ? (
          <span role="status" className={`text-xs ${message.error ? "text-red-300" : "text-emerald-300"}`}>
            {message.text}
          </span>
        ) : null}
      </div>
    </section>
  );
}
