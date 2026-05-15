"use client";

import { useCallback, useState } from "react";
import {
  readBudgetAlertPreferences,
  writeBudgetAlertPreferences,
  type BudgetAlertPreferences,
} from "@/lib/budget-alert-preferences";

const checkboxClass =
  "h-4 w-4 rounded border-slate-600 bg-slate-900 text-blue-500 focus:ring-2 focus:ring-blue-500/40";

export function BudgetAlertPreferences({ emailConfigured }: { emailConfigured: boolean }) {
  const [prefs, setPrefs] = useState(() => readBudgetAlertPreferences());
  const [browserSupported] = useState(
    () => typeof window !== "undefined" && "Notification" in window,
  );

  const update = useCallback((patch: Partial<BudgetAlertPreferences>) => {
    setPrefs((prev) => {
      const next = { ...prev, ...patch };
      writeBudgetAlertPreferences(next);
      return next;
    });
  }, []);

  const requestBrowserPermission = useCallback(async () => {
    if (!browserSupported) return;
    if (Notification.permission === "default") {
      await Notification.requestPermission();
    }
    update({ browserEnabled: true });
  }, [browserSupported, update]);

  return (
    <section className="space-y-4 rounded-2xl border border-slate-800 bg-slate-950/40 p-4 sm:p-5">
      <div className="space-y-1">
        <h3 className="text-base font-semibold text-slate-100">Budget alert notifications</h3>
        <p className="text-sm text-slate-400">
          Warnings appear on the dashboard when a category reaches 80% of its monthly limit. Optional
          notifications fire when thresholds are crossed.
        </p>
      </div>

      <label className="flex cursor-pointer items-start gap-3">
        <input
          type="checkbox"
          className={checkboxClass}
          checked={prefs.browserEnabled}
          disabled={!browserSupported}
          onChange={(e) => {
            if (e.target.checked) void requestBrowserPermission();
            else update({ browserEnabled: false });
          }}
        />
        <span className="text-sm text-slate-300">
          <span className="font-medium text-slate-200">Browser notifications</span>
          <span className="mt-0.5 block text-xs text-slate-500">
            {browserSupported
              ? "Uses the Web Notifications API when you open the dashboard and a warning applies."
              : "Not supported in this browser."}
          </span>
        </span>
      </label>

      <label className="flex cursor-pointer items-start gap-3">
        <input
          type="checkbox"
          className={checkboxClass}
          checked={prefs.emailEnabled}
          disabled={!emailConfigured}
          onChange={(e) => update({ emailEnabled: e.target.checked })}
        />
        <span className="text-sm text-slate-300">
          <span className="font-medium text-slate-200">Email alerts</span>
          <span className="mt-0.5 block text-xs text-slate-500">
            {emailConfigured
              ? "Sends to your account email when SMTP is configured on the server (delivery pending implementation)."
              : "Requires SMTP_HOST, SMTP_USER, SMTP_PASS, and SMTP_FROM on the server."}
          </span>
        </span>
      </label>
    </section>
  );
}
