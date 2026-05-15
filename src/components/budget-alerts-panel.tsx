"use client";

import { useEffect, useMemo } from "react";
import { formatCurrency } from "@/lib/money";
import {
  readBudgetAlertPreferences,
  readNotifiedMap,
  shouldNotifyBrowser,
  writeNotifiedMap,
  type BudgetWarningSeverityStored,
} from "@/lib/budget-alert-preferences";
import type { BudgetTrendAlert, BudgetWarning } from "@/lib/budget-alerts";

export type BudgetAlertsPanelProps = {
  warnings: BudgetWarning[];
  paceTrends: BudgetTrendAlert[];
  momTrends: BudgetTrendAlert[];
  periodLabel: string;
};

function severityBorder(severity: BudgetWarning["severity"]) {
  return severity === "critical"
    ? "border-red-500/40 bg-red-950/30"
    : "border-amber-500/35 bg-amber-950/25";
}

function severityDot(severity: BudgetWarning["severity"]) {
  return severity === "critical" ? "bg-red-400" : "bg-amber-400";
}

export function BudgetAlertsPanel({
  warnings,
  paceTrends,
  momTrends,
  periodLabel,
}: BudgetAlertsPanelProps) {
  const hasContent = warnings.length > 0 || paceTrends.length > 0 || momTrends.length > 0;

  const notifyPayload = useMemo(
    () =>
      warnings.map((w) => ({
        categoryId: w.categoryId,
        severity: w.severity as BudgetWarningSeverityStored,
        message: w.message,
      })),
    [warnings],
  );

  useEffect(() => {
    if (notifyPayload.length === 0) return;
    const prefs = readBudgetAlertPreferences();
    if (!prefs.browserEnabled) return;
    if (typeof window === "undefined" || !("Notification" in window)) return;

    const run = async () => {
      if (Notification.permission === "default") {
        await Notification.requestPermission();
      }
      if (Notification.permission !== "granted") return;

      const notified = readNotifiedMap();
      const next = { ...notified };
      let changed = false;

      for (const item of notifyPayload) {
        if (!shouldNotifyBrowser(item.categoryId, item.severity, notified)) continue;
        new Notification("Budget alert", {
          body: item.message,
          tag: `budget-${item.categoryId}-${item.severity}`,
        });
        next[item.categoryId] = item.severity;
        changed = true;
      }

      if (changed) writeNotifiedMap(next);
    };

    void run();
  }, [notifyPayload]);

  if (!hasContent) return null;

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-4 shadow-lg">
      <div className="mb-3 flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between">
        <h2 className="text-lg font-semibold text-slate-100">Budget alerts &amp; insights</h2>
        <p className="text-xs text-slate-400">{periodLabel}</p>
      </div>

      {warnings.length > 0 ? (
        <section className="space-y-2" aria-label="Budget warnings">
          <h3 className="text-xs font-medium uppercase tracking-wide text-slate-500">Warnings</h3>
          <ul className="space-y-2">
            {warnings.map((w) => (
              <li
                key={w.categoryId}
                className={`rounded-xl border p-3 ${severityBorder(w.severity)}`}
              >
                <div className="flex items-start gap-2">
                  <span
                    className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${severityDot(w.severity)}`}
                    aria-hidden
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-slate-100">{w.message}</p>
                    <p className="mt-1 text-xs tabular-nums text-slate-400">
                      {formatCurrency(w.spentCents)} / {formatCurrency(w.limitCents)}
                    </p>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {paceTrends.length > 0 ? (
        <section className={`space-y-2 ${warnings.length > 0 ? "mt-4" : ""}`} aria-label="Over-budget pace">
          <h3 className="text-xs font-medium uppercase tracking-wide text-slate-500">
            Over-budget pace
          </h3>
          <ul className="space-y-2">
            {paceTrends.map((t) => (
              <li
                key={`pace-${t.categoryId}`}
                className="rounded-xl border border-orange-500/30 bg-orange-950/20 p-3"
              >
                <p className="text-sm text-slate-200">{t.message}</p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {momTrends.length > 0 ? (
        <section className="mt-4 space-y-2" aria-label="Month-over-month trends">
          <h3 className="text-xs font-medium uppercase tracking-wide text-slate-500">
            vs last month
          </h3>
          <ul className="space-y-2">
            {momTrends.map((t) => (
              <li
                key={`mom-${t.categoryId}`}
                className="rounded-xl border border-slate-700 bg-slate-950/50 p-3"
              >
                <p className="text-sm text-slate-300">{t.message}</p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <p className="mt-3 text-xs text-slate-500">
        Enable browser or email alerts in{" "}
        <a href="/settings#budgets" className="text-blue-300 underline-offset-4 hover:underline">
          Settings → Budgets
        </a>
        .
      </p>
    </div>
  );
}
