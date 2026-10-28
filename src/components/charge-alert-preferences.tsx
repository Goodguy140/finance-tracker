"use client";

import { useState, useTransition } from "react";
import { setChargeAlertsAction } from "@/app/actions";
import { isActionFailure } from "@/lib/action-result";
import { fromCents } from "@/lib/money";

/** Settings → Notifications: an email (and phone notification) when a bank sync brings in a large or unusual charge. */
export function ChargeAlertPreferences({
  emailConfigured,
  phoneReady,
  currency,
  thresholdCents,
  unusual,
}: {
  emailConfigured: boolean;
  phoneReady: boolean;
  currency: string;
  thresholdCents: number | null;
  unusual: boolean;
}) {
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const save = (formData: FormData) => {
    setMessage(null);
    formData.set("unusual", formData.get("unusual") === "on" ? "true" : "false");
    startTransition(async () => {
      const result = await setChargeAlertsAction(formData);
      setMessage(isActionFailure(result) ? { ok: false, text: result.error } : { ok: true, text: "Saved." });
    });
  };

  return (
    <section
      aria-label="Charge alerts"
      className="space-y-3 rounded-xl border border-slate-800 bg-slate-900/50 p-4 sm:p-5"
    >
      <div className="space-y-1">
        <h3 className="text-base font-semibold text-slate-100">Charge alerts</h3>
        <p className="text-sm text-slate-400">
          An alert (by email, and on phones set up below) when a connected bank brings in a charge over an amount you choose, or one well above what that
          merchant usually charges (at least three times as much). Checked hourly; each charge is looked at once.
        </p>
      </div>
      {emailConfigured ? null : (
        <p className="text-xs text-amber-200">
          Email needs SMTP_HOST, SMTP_USER, SMTP_PASS, and SMTP_FROM on the server.{" "}
          {phoneReady ? "These go to your phone instead." : "Or turn on Phone notifications below to get these there."}
        </p>
      )}
      <form action={save} className="space-y-3">
        <fieldset className="space-y-3" disabled={(!emailConfigured && !phoneReady) || pending}>
          <label className="block space-y-1">
            <span className="text-sm font-medium text-slate-200">Any charge of at least ({currency})</span>
            <input
              name="threshold"
              inputMode="decimal"
              placeholder="Off"
              defaultValue={thresholdCents === null ? "" : String(fromCents(thresholdCents))}
              className="block w-40 rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100"
            />
          </label>
          <label className="flex cursor-pointer items-center gap-3">
            <input
              type="checkbox"
              name="unusual"
              defaultChecked={unusual}
              className="h-4 w-4 rounded border-slate-600 bg-slate-900 text-blue-500"
            />
            <span className="text-sm font-medium text-slate-200">Charges unusual for the merchant</span>
          </label>
          <button
            type="submit"
            className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
          >
            Save charge alerts
          </button>
        </fieldset>
      </form>
      {message ? (
        <p role="status" className={`text-xs ${message.ok ? "text-emerald-300" : "text-red-300"}`}>
          {message.text}
        </p>
      ) : null}
    </section>
  );
}
