"use client";

import { useCallback, useEffect, useId, useMemo, useState, useSyncExternalStore } from "react";
import { formatCurrency } from "@/lib/money";
import {
  budgetWarningDismissalKey,
  getServerDismissedBudgetWarningsSnapshot,
  readDismissedBudgetWarnings,
  readBudgetAlertPreferences,
  readNotifiedMap,
  shouldNotifyBrowser,
  subscribeDismissedBudgetWarnings,
  writeDismissedBudgetWarnings,
  writeNotifiedMap,
  type BudgetWarningSeverityStored,
  type DismissedBudgetWarningMap,
} from "@/lib/budget-alert-preferences";
import type { BudgetTrendAlert, BudgetWarning } from "@/lib/budget-alerts";

const BUDGET_ALERTS_PANEL_EXPANDED_KEY = "finance-tracker:budget-alerts-panel-expanded";

const budgetAlertsPanelExpandedListeners = new Set<() => void>();

function subscribeBudgetAlertsPanelExpanded(listener: () => void) {
  budgetAlertsPanelExpandedListeners.add(listener);
  const onStorage = (e: StorageEvent) => {
    if (e.key === BUDGET_ALERTS_PANEL_EXPANDED_KEY || e.key === null) listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    budgetAlertsPanelExpandedListeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

function emitBudgetAlertsPanelExpanded() {
  budgetAlertsPanelExpandedListeners.forEach((l) => l());
}

function readBudgetAlertsPanelExpanded(): boolean {
  if (typeof window === "undefined") return true;
  return window.localStorage.getItem(BUDGET_ALERTS_PANEL_EXPANDED_KEY) !== "false";
}

function getBudgetAlertsPanelExpandedServerSnapshot(): boolean {
  return true;
}

function persistBudgetAlertsPanelExpanded(expanded: boolean) {
  try {
    window.localStorage.setItem(BUDGET_ALERTS_PANEL_EXPANDED_KEY, expanded ? "true" : "false");
  } catch {
    /* private mode */
  }
  emitBudgetAlertsPanelExpanded();
}

export type BudgetAlertsPanelProps = {
  warnings: BudgetWarning[];
  paceTrends: BudgetTrendAlert[];
  momTrends: BudgetTrendAlert[];
  periodLabel: string;
  periodKey: string;
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
  periodKey,
}: BudgetAlertsPanelProps) {
  const dismissedWarnings = useSyncExternalStore(
    subscribeDismissedBudgetWarnings,
    readDismissedBudgetWarnings,
    getServerDismissedBudgetWarningsSnapshot,
  );
  const [showDismissed, setShowDismissed] = useState(false);
  const panelContentId = useId();
  const expanded = useSyncExternalStore(
    subscribeBudgetAlertsPanelExpanded,
    readBudgetAlertsPanelExpanded,
    getBudgetAlertsPanelExpandedServerSnapshot,
  );

  const warningRows = useMemo(
    () =>
      warnings.map((warning) => ({
        warning,
        dismissalKey: budgetWarningDismissalKey({
          periodKey,
          categoryId: warning.categoryId,
          severity: warning.severity as BudgetWarningSeverityStored,
        }),
      })),
    [periodKey, warnings],
  );

  const activeWarnings = useMemo(
    () => warningRows.filter((row) => !dismissedWarnings[row.dismissalKey]),
    [dismissedWarnings, warningRows],
  );
  const dismissedWarningRows = useMemo(
    () => warningRows.filter((row) => dismissedWarnings[row.dismissalKey]),
    [dismissedWarnings, warningRows],
  );
  const hasWarningContent = activeWarnings.length > 0 || dismissedWarningRows.length > 0;
  const hasContent = hasWarningContent || paceTrends.length > 0 || momTrends.length > 0;
  const insightCount = activeWarnings.length + paceTrends.length + momTrends.length;

  const toggleExpanded = useCallback(() => {
    persistBudgetAlertsPanelExpanded(!expanded);
  }, [expanded]);

  const updateDismissedWarnings = useCallback(
    (update: (prev: DismissedBudgetWarningMap) => DismissedBudgetWarningMap) => {
      writeDismissedBudgetWarnings(update(readDismissedBudgetWarnings()));
    },
    [],
  );

  const dismissWarning = useCallback(
    (dismissalKey: string) => {
      updateDismissedWarnings((prev) => ({ ...prev, [dismissalKey]: true }));
    },
    [updateDismissedWarnings],
  );

  const restoreWarning = useCallback(
    (dismissalKey: string) => {
      updateDismissedWarnings((prev) => {
        const next = { ...prev };
        delete next[dismissalKey];
        return next;
      });
    },
    [updateDismissedWarnings],
  );

  const notifyPayload = useMemo(
    () =>
      activeWarnings.map(({ warning }) => ({
        categoryId: warning.categoryId,
        severity: warning.severity as BudgetWarningSeverityStored,
        message: warning.message,
      })),
    [activeWarnings],
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
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={panelContentId}
        onClick={toggleExpanded}
        className={`-mx-1 flex w-[calc(100%+0.5rem)] touch-manipulation items-start justify-between gap-3 rounded-xl px-1 py-0.5 text-left transition hover:bg-slate-800/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500/60 ${expanded ? "mb-3" : ""}`}
      >
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-semibold text-slate-100">Budget alerts &amp; insights</h2>
          <p className="mt-0.5 text-xs text-slate-400">
            {periodLabel}
            {!expanded && insightCount > 0 ? (
              <span className="text-slate-500">
                {" "}
                · {insightCount} {insightCount === 1 ? "insight" : "insights"}
              </span>
            ) : null}
          </p>
        </div>
        <span
          className={`mt-1 shrink-0 text-slate-400 transition-transform duration-200 ${expanded ? "rotate-180" : ""}`}
          aria-hidden
        >
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </span>
      </button>

      {expanded ? (
      <div id={panelContentId}>
      {activeWarnings.length > 0 ? (
        <section className="space-y-2" aria-label="Budget warnings">
          <h3 className="text-xs font-medium uppercase tracking-wide text-slate-500">Warnings</h3>
          <ul className="space-y-2">
            {activeWarnings.map(({ warning: w, dismissalKey }) => (
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
                  <button
                    type="button"
                    onClick={() => dismissWarning(dismissalKey)}
                    className="shrink-0 rounded-lg border border-slate-700/80 px-2 py-1 text-xs font-medium text-slate-300 transition hover:border-slate-500 hover:bg-slate-900/70 hover:text-slate-100"
                  >
                    Dismiss
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {dismissedWarningRows.length > 0 ? (
        <section
          className={`space-y-2 ${activeWarnings.length > 0 ? "mt-4" : ""}`}
          aria-label="Dismissed budget warnings"
        >
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-xs font-medium uppercase tracking-wide text-slate-500">
              Dismissed warnings
            </h3>
            <button
              type="button"
              aria-expanded={showDismissed}
              onClick={() => setShowDismissed((shown) => !shown)}
              className="text-xs font-medium text-blue-300 underline-offset-4 transition hover:text-blue-200 hover:underline"
            >
              {showDismissed ? "Hide dismissed" : `Show dismissed (${dismissedWarningRows.length})`}
            </button>
          </div>
          {showDismissed ? (
            <ul className="space-y-2">
              {dismissedWarningRows.map(({ warning: w, dismissalKey }) => (
                <li
                  key={`dismissed-${w.categoryId}`}
                  className="rounded-xl border border-slate-800 bg-slate-950/45 p-3"
                >
                  <div className="flex items-start gap-2">
                    <span
                      className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${severityDot(w.severity)}`}
                      aria-hidden
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-slate-300">{w.message}</p>
                      <p className="mt-1 text-xs tabular-nums text-slate-500">
                        {formatCurrency(w.spentCents)} / {formatCurrency(w.limitCents)}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => restoreWarning(dismissalKey)}
                      className="shrink-0 rounded-lg border border-slate-700/80 px-2 py-1 text-xs font-medium text-slate-300 transition hover:border-slate-500 hover:bg-slate-900/70 hover:text-slate-100"
                    >
                      Restore
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-slate-500">
              Dismissed warnings stay hidden for this budget period unless the budget reaches a higher alert level.
            </p>
          )}
        </section>
      ) : null}

      {paceTrends.length > 0 ? (
        <section className={`space-y-2 ${hasWarningContent ? "mt-4" : ""}`} aria-label="Over-budget pace">
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
      ) : null}
    </div>
  );
}
