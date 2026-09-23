"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { formatCurrency } from "@/lib/money";
import { MOBILE_OVERLAY_ROOT_Z_CLASS, MOBILE_OVERLAY_SHEET_Z_CLASS } from "@/lib/mobile-z-index";
import { showLocalNotification } from "@/lib/pwa-notifications";
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
import type { BudgetProgressInput, BudgetTrendAlert, BudgetWarning } from "@/lib/budget-alerts";
import { BudgetReallocateDialog } from "@/components/budget-reallocate-dialog";
import { headroomCents } from "@/lib/budget-reallocation";

function subscribeMobileViewport(onStoreChange: () => void) {
  const mediaQuery = window.matchMedia("(max-width: 639px)");
  mediaQuery.addEventListener("change", onStoreChange);
  return () => mediaQuery.removeEventListener("change", onStoreChange);
}

function readMobileViewport() {
  return window.matchMedia("(max-width: 639px)").matches;
}

export type BudgetAlertsPanelProps = {
  warnings: BudgetWarning[];
  paceTrends: BudgetTrendAlert[];
  momTrends: BudgetTrendAlert[];
  /** Current-month budget rows, used as reallocation sources when covering an overage. */
  budgets: BudgetProgressInput[];
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

function BellIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75} aria-hidden>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M14.857 17.082a23.848 23.848 0 0 0 5.454-1.31A8.967 8.967 0 0 1 18 9.75V9A6 6 0 0 0 6 9v.75a8.967 8.967 0 0 1-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 0 1-5.714 0m5.714 0a3 3 0 1 1-5.714 0"
      />
    </svg>
  );
}

const triggerClassName =
  "relative touch-manipulation inline-flex min-h-9 min-w-9 items-center justify-center rounded-lg border border-slate-700/80 bg-slate-900/90 text-slate-200 transition hover:border-slate-600 hover:bg-slate-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500/60 lg:min-h-0 lg:rounded-xl lg:px-2.5 lg:py-1.5";

const panelShellClassName =
  "max-h-[min(85vh,36rem)] overflow-y-auto overscroll-contain rounded-2xl border border-slate-700 bg-slate-950/98 p-4 shadow-2xl backdrop-blur";

export function BudgetAlertsPanel({
  warnings,
  paceTrends,
  momTrends,
  budgets,
  periodLabel,
  periodKey,
}: BudgetAlertsPanelProps) {
  const [reallocateFor, setReallocateFor] = useState<BudgetWarning | null>(null);
  const totalHeadroomCents = useMemo(
    () => budgets.reduce((sum, budget) => sum + headroomCents(budget), 0),
    [budgets],
  );
  const dismissedWarnings = useSyncExternalStore(
    subscribeDismissedBudgetWarnings,
    readDismissedBudgetWarnings,
    getServerDismissedBudgetWarningsSnapshot,
  );
  const [open, setOpen] = useState(false);
  const [showDismissed, setShowDismissed] = useState(false);
  const panelContentId = useId();
  const panelTitleId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const isMobileViewport = useSyncExternalStore(subscribeMobileViewport, readMobileViewport, () => true);

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
    if (typeof window === "undefined") return;

    // Reconcile the "already notified" record with the current breach reality so
    // a category that was resolved (dropped below its limit) and later goes over
    // again can alert once more. `warnings` reflects every still-breached
    // category (dismissed or not); anything missing from it has resolved.
    const currentSeverityById = new Map(warnings.map((w) => [w.categoryId, w.severity]));
    const stored = readNotifiedMap();
    const next: typeof stored = { ...stored };
    let changed = false;
    for (const categoryId of Object.keys(stored)) {
      const current = currentSeverityById.get(categoryId);
      if (!current) {
        delete next[categoryId];
        changed = true;
      } else if (stored[categoryId] === "critical" && current === "warning") {
        // Cooled off from over-budget to a plain warning: allow a future
        // re-escalation to critical to notify again.
        next[categoryId] = "warning";
        changed = true;
      }
    }

    const prefs = readBudgetAlertPreferences();
    const canNotify = prefs.browserEnabled && "Notification" in window;

    const run = async () => {
      if (canNotify && notifyPayload.length > 0) {
        if (Notification.permission === "default") {
          await Notification.requestPermission();
        }
        if (Notification.permission === "granted") {
          for (const item of notifyPayload) {
            if (!shouldNotifyBrowser(item.categoryId, item.severity, next)) continue;
            const shown = await showLocalNotification("Budget alert", {
              body: item.message,
              tag: `budget-${item.categoryId}-${item.severity}`,
              icon: "/icons/icon-192.png",
            });
            // Not recorded as sent unless it was, so the next dashboard visit retries.
            if (!shown) continue;
            next[item.categoryId] = item.severity;
            changed = true;
          }
        }
      }
      if (changed) writeNotifiedMap(next);
    };

    void run();
  }, [notifyPayload, warnings]);

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  useEffect(() => {
    if (!open || isMobileViewport) return;

    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current?.contains(event.target as Node)) return;
      setOpen(false);
    };

    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open, isMobileViewport]);

  if (!hasContent) return null;

  const panelBody = (
    <div id={panelContentId}>
      {activeWarnings.length > 0 ? (
        <section className="space-y-2" aria-label="Budget warnings">
          <h3 className="text-xs font-medium uppercase tracking-wide text-slate-500">Warnings</h3>
          <ul className="space-y-2">
            {activeWarnings.map(({ warning: w, dismissalKey }) => (
              <li key={w.categoryId} className={`rounded-xl border p-3 ${severityBorder(w.severity)}`}>
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
                    {w.severity === "critical" && totalHeadroomCents - headroomCents(w) > 0 ? (
                      <p className="mt-1 text-xs text-blue-300">
                        ≈ {formatCurrency(totalHeadroomCents - headroomCents(w))} available in other budgets
                      </p>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 flex-col gap-1">
                    {w.severity === "critical" ? (
                      <button
                        type="button"
                        onClick={() => setReallocateFor(w)}
                        className="rounded-lg border border-blue-500/50 bg-blue-500/10 px-2 py-1 text-xs font-medium text-blue-200 transition hover:border-blue-400 hover:bg-blue-500/20"
                      >
                        Rebalance
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => dismissWarning(dismissalKey)}
                      className="rounded-lg border border-slate-700/80 px-2 py-1 text-xs font-medium text-slate-300 transition hover:border-slate-500 hover:bg-slate-900/70 hover:text-slate-100"
                    >
                      Dismiss
                    </button>
                  </div>
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
            <h3 className="text-xs font-medium uppercase tracking-wide text-slate-500">Dismissed warnings</h3>
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
          <h3 className="text-xs font-medium uppercase tracking-wide text-slate-500">Over-budget pace</h3>
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
          <h3 className="text-xs font-medium uppercase tracking-wide text-slate-500">vs last month</h3>
          <ul className="space-y-2">
            {momTrends.map((t) => (
              <li key={`mom-${t.categoryId}`} className="rounded-xl border border-slate-700 bg-slate-950/50 p-3">
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

  const panelHeader = (
    <div className="mb-3 border-b border-slate-800/90 pb-3">
      <h2 id={panelTitleId} className="text-base font-semibold text-slate-100">
        Budget alerts &amp; insights
      </h2>
      <p className="mt-0.5 text-xs text-slate-400">{periodLabel}</p>
    </div>
  );

  const panel = (
    <>
      {panelHeader}
      {panelBody}
      {isMobileViewport ? (
        <div className="mt-4 flex justify-end border-t border-slate-800/90 pt-3">
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="touch-manipulation rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm font-medium text-slate-200 transition hover:bg-slate-800"
          >
            Close
          </button>
        </div>
      ) : null}
    </>
  );

  return (
    <>
    <div ref={rootRef} className="relative shrink-0">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={open ? panelContentId : undefined}
        aria-haspopup="dialog"
        aria-label={
          insightCount > 0
            ? `Budget alerts and insights, ${insightCount} ${insightCount === 1 ? "item" : "items"}`
            : "Budget alerts and insights"
        }
        onClick={() => setOpen((prev) => !prev)}
        className={triggerClassName}
      >
        <BellIcon className="h-5 w-5" />
        {insightCount > 0 ? (
          <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-amber-500 px-1 text-[10px] font-bold leading-none text-slate-950">
            {insightCount > 9 ? "9+" : insightCount}
          </span>
        ) : null}
      </button>

      {open
        ? isMobileViewport && typeof document !== "undefined"
          ? createPortal(
              <div className={`fixed inset-0 ${MOBILE_OVERLAY_ROOT_Z_CLASS} lg:hidden`} role="presentation">
                <button
                  type="button"
                  className="absolute inset-0 bg-black/65 backdrop-blur-[2px]"
                  aria-label="Close budget alerts"
                  onClick={() => setOpen(false)}
                />
                <div
                  className={`fixed inset-x-0 bottom-0 ${MOBILE_OVERLAY_SHEET_Z_CLASS} flex max-h-[min(92dvh,calc(100dvh-env(safe-area-inset-top)))] flex-col rounded-t-3xl border border-slate-700 border-b-0 bg-slate-900 shadow-2xl`}
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby={panelTitleId}
                >
                  <div className="flex shrink-0 justify-center pt-2 pb-1">
                    <span className="h-1 w-10 rounded-full bg-slate-600" aria-hidden />
                  </div>
                  <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-1">
                    {panel}
                  </div>
                </div>
              </div>,
              document.body,
            )
          : (
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby={panelTitleId}
              className={`absolute right-0 top-full z-[60] mt-2 w-[min(92vw,32rem)] ${panelShellClassName}`}
            >
              {panel}
            </div>
          )
        : null}
    </div>
    {reallocateFor ? (
      <BudgetReallocateDialog
        destination={{
          categoryId: reallocateFor.categoryId,
          categoryName: reallocateFor.categoryName,
          spentCents: reallocateFor.spentCents,
          limitCents: reallocateFor.limitCents,
        }}
        candidates={budgets}
        onClose={() => setReallocateFor(null)}
        onApplied={() => setReallocateFor(null)}
      />
    ) : null}
    </>
  );
}
