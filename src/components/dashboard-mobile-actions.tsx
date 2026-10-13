"use client";

import { useId, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ExpenseForm, IncomeForm, TransferForm } from "@/components/forms";
import type { ExpenseTitleSuggestion } from "@/lib/expense-title-suggestions";
import { useOnlineStatus } from "@/lib/use-online-status";
import {
  MOBILE_FAB_Z_CLASS,
  MOBILE_OVERLAY_ROOT_Z_CLASS,
  MOBILE_OVERLAY_SHEET_Z_CLASS,
} from "@/lib/mobile-z-index";

type Option = { id: string; name: string };

const sheetShellClass = `fixed inset-x-0 bottom-0 ${MOBILE_OVERLAY_SHEET_Z_CLASS} flex max-h-[min(92dvh,calc(100dvh-env(safe-area-inset-top)))] flex-col rounded-t-3xl border border-slate-700 border-b-0 bg-slate-900 shadow-2xl lg:hidden`;

const sheetBodyClass =
  "min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pt-2 pb-[max(1rem,env(safe-area-inset-bottom))]";

function MobileFormSheet({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const titleId = useId();
  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div className={`fixed inset-0 ${MOBILE_OVERLAY_ROOT_Z_CLASS} lg:hidden`} role="presentation">
      <button
        type="button"
        className="absolute inset-0 bg-black/65 backdrop-blur-[2px]"
        aria-label="Close sheet"
        onClick={onClose}
      />
      <div className={sheetShellClass} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="flex shrink-0 justify-center pt-2 pb-1">
          <span className="h-1 w-10 rounded-full bg-slate-600" aria-hidden />
        </div>
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-800/90 px-4 pb-3 pt-1">
          <h2 id={titleId} className="text-lg font-semibold text-slate-100">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="touch-manipulation min-h-11 rounded-xl border border-slate-600 bg-slate-800 px-3 py-2.5 text-sm font-medium text-slate-200 transition hover:bg-slate-700"
          >
            Close
          </button>
        </div>
        <div className={sheetBodyClass}>{children}</div>
      </div>
    </div>,
    document.body,
  );
}

export function DashboardMobileActions({
  accounts,
  expenseCategories,
  incomeCategories,
  defaultExpenseAccountId,
  titleSuggestions,
}: {
  accounts: Option[];
  expenseCategories: Option[];
  incomeCategories: Option[];
  defaultExpenseAccountId?: string | null;
  titleSuggestions: ExpenseTitleSuggestion[];
}) {
  const [open, setOpen] = useState<"expense" | "income" | "transfer" | null>(null);
  // Offline, the dashboard may be a cached copy: nothing can be saved, so don't offer to.
  const online = useOnlineStatus();

  return (
    <>
      {/* Floats just above the app's tab bar (3.5rem plus the home-indicator inset). */}
      <div
        className={`pointer-events-none fixed inset-x-0 bottom-[calc(3.5rem+env(safe-area-inset-bottom))] ${MOBILE_FAB_Z_CLASS} flex justify-center gap-2 px-3 pb-2 pt-2 lg:hidden`}
      >
        <button
          type="button"
          aria-label="Quick add expense"
          disabled={!online}
          onClick={() => setOpen("expense")}
          className="pointer-events-auto touch-manipulation inline-flex min-h-12 items-center justify-center rounded-full bg-blue-500 px-5 text-sm font-semibold text-white shadow-lg shadow-blue-950/40 ring-2 ring-blue-400/25 transition hover:bg-blue-400 active:bg-blue-600 disabled:opacity-50 disabled:shadow-none"
        >
          + Expense
        </button>
        <button
          type="button"
          aria-label="Quick add income"
          disabled={!online}
          onClick={() => setOpen("income")}
          className="pointer-events-auto touch-manipulation inline-flex min-h-12 items-center justify-center rounded-full border border-slate-600 bg-slate-800 px-4 text-sm font-semibold text-slate-100 shadow-lg shadow-black/30 transition hover:bg-slate-700 active:bg-slate-900 disabled:opacity-50 disabled:shadow-none"
        >
          + Income
        </button>
        <button
          type="button"
          aria-label="Quick add transfer"
          disabled={!online}
          onClick={() => setOpen("transfer")}
          className="pointer-events-auto touch-manipulation inline-flex min-h-12 items-center justify-center rounded-full border border-slate-600 bg-slate-800 px-4 text-sm font-semibold text-slate-100 shadow-lg shadow-black/30 transition hover:bg-slate-700 active:bg-slate-900 disabled:opacity-50 disabled:shadow-none"
        >
          + Transfer
        </button>
      </div>

      <MobileFormSheet
        open={open === "expense"}
        title="Add expense"
        onClose={() => setOpen(null)}
      >
        <ExpenseForm
          accounts={accounts}
          expenseCategories={expenseCategories}
          defaultExpenseAccountId={defaultExpenseAccountId}
          titleSuggestions={titleSuggestions}
          variant="mobileSheet"
          onSuccess={() => setOpen(null)}
        />
      </MobileFormSheet>

      <MobileFormSheet
        open={open === "income"}
        title="Add income"
        onClose={() => setOpen(null)}
      >
        <IncomeForm
          accounts={accounts}
          incomeCategories={incomeCategories}
          variant="mobileSheet"
          onSuccess={() => setOpen(null)}
        />
      </MobileFormSheet>

      <MobileFormSheet open={open === "transfer"} title="Add transfer" onClose={() => setOpen(null)}>
        <TransferForm accounts={accounts} variant="mobileSheet" onSuccess={() => setOpen(null)} />
      </MobileFormSheet>
    </>
  );
}
