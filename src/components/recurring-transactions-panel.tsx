"use client";

import { useMemo, useState } from "react";
import {
  deleteRecurringTransactionAction,
  postRecurringTransactionAction,
  setRecurringTransactionEnabledAction,
  skipRecurringOccurrenceAction,
  updateRecurringTransactionAction,
} from "@/app/actions";
import { ServerActionForm } from "@/components/server-action-form";
import { MetaChip } from "@/components/meta-chip";
import { formatCurrency } from "@/lib/money";
import { MOBILE_OVERLAY_ROOT_Z_CLASS } from "@/lib/mobile-z-index";

export type RecurringTransactionListItem = {
  id: string;
  type: "EXPENSE" | "INCOME";
  typeLabel: string;
  name: string;
  amountCents: number;
  accountId: string;
  accountLabel: string;
  categoryId: string;
  categoryLabel: string;
  cadence: "WEEKLY" | "BIWEEKLY" | "MONTHLY" | "QUARTERLY" | "YEARLY" | "BIENNIAL";
  cadenceLabel: string;
  nextExpectedDateYmd: string;
  nextExpectedDateDisplay: string;
  endDateYmd: string | null;
  endDateDisplay: string | null;
  note: string | null;
  enabled: boolean;
  status: "overdue" | "due" | "upcoming" | "disabled";
};

type Option = { id: string; name: string };

export type RecentExpenseOption = {
  id: string;
  title: string;
  dateDisplay: string;
  amountCents: number;
};

const inputClass =
  "w-full min-h-[2.75rem] rounded-xl border border-slate-700 bg-slate-950/70 px-3 py-2.5 text-base leading-normal text-slate-100 placeholder:text-slate-500 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-500/20 sm:text-sm";
const selectClass =
  "w-full min-h-[2.75rem] rounded-xl border border-slate-700 bg-slate-950/70 px-3 py-2.5 text-base text-slate-100 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-500/20 sm:text-sm";
const textAreaClass =
  "w-full min-h-[4.5rem] rounded-xl border border-slate-700 bg-slate-950/70 px-3 py-2.5 text-base leading-normal text-slate-100 placeholder:text-slate-500 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-500/20 sm:text-sm";
const primaryBtnClass =
  "touch-manipulation rounded-xl bg-blue-500 px-3 py-2 text-sm font-medium text-white transition hover:bg-blue-400";
const secondaryBtnClass =
  "touch-manipulation rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm font-medium text-slate-200 transition hover:border-slate-600 hover:bg-slate-800";

function statusLabel(status: RecurringTransactionListItem["status"]) {
  switch (status) {
    case "overdue":
      return "Overdue";
    case "due":
      return "Due today";
    case "disabled":
      return "Disabled";
    case "upcoming":
      return "Upcoming";
  }
}

function statusClass(status: RecurringTransactionListItem["status"]) {
  if (status === "overdue") return "border-red-500/45 bg-red-500/15 text-red-100";
  if (status === "due") return "border-amber-400/45 bg-amber-400/15 text-amber-100";
  if (status === "disabled") return "border-slate-600 bg-slate-800/70 text-slate-300";
  return "border-blue-500/35 bg-blue-500/15 text-blue-100";
}

function RecurringCard({
  item,
  onEdit,
  onSkip,
}: {
  item: RecurringTransactionListItem;
  onEdit: (item: RecurringTransactionListItem) => void;
  onSkip: (item: RecurringTransactionListItem) => void;
}) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-2.5 text-left text-sm text-slate-100">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <span className="block font-semibold leading-snug text-slate-100">{item.name}</span>
          {item.note ? <span className="mt-0.5 block text-xs text-slate-400">{item.note}</span> : null}
        </div>
        <span
          className={`shrink-0 rounded-full border px-2.5 py-1 text-sm font-semibold tabular-nums ${
            item.type === "INCOME"
              ? "border-emerald-500/35 bg-emerald-500/15 text-emerald-100"
              : "border-blue-500/35 bg-blue-500/15 text-blue-100"
          }`}
        >
          {item.type === "INCOME" ? "+" : "-"}
          {formatCurrency(item.amountCents)}
        </span>
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        <span className={`rounded-full border px-2 py-1 text-xs font-medium ${statusClass(item.status)}`}>
          {statusLabel(item.status)}
        </span>
        <MetaChip label="Type">{item.typeLabel}</MetaChip>
        <MetaChip label="Category">{item.categoryLabel}</MetaChip>
        <MetaChip label="Account">{item.accountLabel}</MetaChip>
        <MetaChip label="Cadence">{item.cadenceLabel}</MetaChip>
        <MetaChip label="Next">{item.nextExpectedDateDisplay}</MetaChip>
        {item.endDateDisplay ? <MetaChip label="Ends">{item.endDateDisplay}</MetaChip> : null}
      </div>
      <div className="mt-3 flex flex-wrap justify-end gap-2">
        {item.enabled ? (
          <ServerActionForm action={postRecurringTransactionAction}>
            <input type="hidden" name="recurringTransactionId" value={item.id} />
            <input type="hidden" name="expectedDate" value={item.nextExpectedDateYmd} />
            <button type="submit" className={primaryBtnClass}>
              Post transaction
            </button>
          </ServerActionForm>
        ) : null}
        {item.enabled ? (
          <button type="button" className={secondaryBtnClass} onClick={() => onSkip(item)}>
            Skip
          </button>
        ) : null}
        <button type="button" className={secondaryBtnClass} onClick={() => onEdit(item)}>
          Edit
        </button>
        <ServerActionForm action={setRecurringTransactionEnabledAction}>
          <input type="hidden" name="recurringTransactionId" value={item.id} />
          <input type="hidden" name="enabled" value={item.enabled ? "false" : "true"} />
          <button type="submit" className={secondaryBtnClass}>
            {item.enabled ? "Disable" : "Enable"}
          </button>
        </ServerActionForm>
        <ServerActionForm action={deleteRecurringTransactionAction}>
          <input type="hidden" name="recurringTransactionId" value={item.id} />
          <button type="submit" className={secondaryBtnClass}>
            Remove
          </button>
        </ServerActionForm>
      </div>
    </div>
  );
}

export function RecurringTransactionsPanel({
  items,
  accounts,
  expenseCategories,
  incomeCategories,
  recentExpenses = [],
}: {
  items: RecurringTransactionListItem[];
  accounts: Option[];
  expenseCategories: Option[];
  incomeCategories: Option[];
  recentExpenses?: RecentExpenseOption[];
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const editingItem = items.find((item) => item.id === editingId) ?? null;
  const [editingType, setEditingType] = useState<"EXPENSE" | "INCOME">("EXPENSE");
  const [skippingId, setSkippingId] = useState<string | null>(null);
  const skippingItem = items.find((item) => item.id === skippingId) ?? null;
  const startEditing = (item: RecurringTransactionListItem) => {
    setEditingType(item.type);
    setEditingId(item.id);
  };
  const startSkipping = (item: RecurringTransactionListItem) => setSkippingId(item.id);

  const groups = useMemo(
    () => [
      { key: "overdue", title: "Overdue", items: items.filter((item) => item.status === "overdue") },
      { key: "due", title: "Due today", items: items.filter((item) => item.status === "due") },
      { key: "upcoming", title: "Upcoming", items: items.filter((item) => item.status === "upcoming") },
      { key: "disabled", title: "Disabled", items: items.filter((item) => item.status === "disabled") },
    ],
    [items],
  );
  const categoryOptions = editingType === "INCOME" ? incomeCategories : expenseCategories;

  if (items.length === 0) {
    return (
      <p className="text-sm text-slate-400">
        No recurring transactions yet. Add one from the{" "}
        <span className="rounded-md border border-slate-700 bg-slate-800/60 px-1.5 py-0.5 text-xs font-medium text-slate-200">
          Add
        </span>{" "}
        menu.
      </p>
    );
  }

  return (
    <>
      <div className="max-h-[min(56vh,32rem)] space-y-4 overflow-y-auto pr-1">
        {groups.map((group) =>
          group.items.length > 0 ? (
            <section key={group.key} className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">{group.title}</h3>
              {group.items.map((item) => (
                <RecurringCard key={item.id} item={item} onEdit={startEditing} onSkip={startSkipping} />
              ))}
            </section>
          ) : null,
        )}
      </div>
      {editingItem ? (
        <div className={`fixed inset-0 ${MOBILE_OVERLAY_ROOT_Z_CLASS} flex items-center justify-center bg-black/60 p-3`}>
          <div className="max-h-[min(92vh,44rem)] w-full max-w-lg overflow-y-auto rounded-2xl border border-slate-700 bg-slate-950 p-4 shadow-2xl">
            <h3 className="text-lg font-semibold text-slate-100">Edit recurring transaction</h3>
            <ServerActionForm
              action={updateRecurringTransactionAction}
              className="mt-3 space-y-3"
              onSuccess={() => setEditingId(null)}
            >
              <input type="hidden" name="recurringTransactionId" value={editingItem.id} />
              <input name="name" defaultValue={editingItem.name} className={inputClass} placeholder="Name" required />
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <select
                  name="type"
                  value={editingType}
                  onChange={(event) => setEditingType(event.target.value as "EXPENSE" | "INCOME")}
                  className={selectClass}
                >
                  <option value="EXPENSE">Expense</option>
                  <option value="INCOME">Income</option>
                </select>
                <select name="accountId" defaultValue={editingItem.accountId} className={selectClass}>
                  {accounts.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.name}
                    </option>
                  ))}
                </select>
                <select name="categoryId" defaultValue={editingItem.categoryId} className={selectClass}>
                  {categoryOptions.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                    </option>
                  ))}
                </select>
                <input
                  name="amount"
                  type="number"
                  step="0.01"
                  min="0.01"
                  defaultValue={(editingItem.amountCents / 100).toFixed(2)}
                  className={inputClass}
                  placeholder="Amount"
                  required
                />
                <select name="cadence" defaultValue={editingItem.cadence} className={selectClass}>
                  <option value="WEEKLY">Weekly</option>
                  <option value="BIWEEKLY">Biweekly</option>
                  <option value="MONTHLY">Monthly</option>
                  <option value="QUARTERLY">Quarterly</option>
                  <option value="YEARLY">Yearly</option>
                  <option value="BIENNIAL">Every 2 years</option>
                </select>
                <input
                  name="nextExpectedDate"
                  type="date"
                  defaultValue={editingItem.nextExpectedDateYmd}
                  className={inputClass}
                  required
                />
                <input
                  name="endDate"
                  type="date"
                  defaultValue={editingItem.endDateYmd ?? ""}
                  className={inputClass}
                  aria-label="Optional end date"
                />
              </div>
              <textarea
                name="note"
                defaultValue={editingItem.note ?? ""}
                className={textAreaClass}
                placeholder="Optional note"
                maxLength={250}
              />
              <div className="flex justify-end gap-2">
                <button type="button" className={secondaryBtnClass} onClick={() => setEditingId(null)}>
                  Cancel
                </button>
                <button type="submit" className={primaryBtnClass}>
                  Save changes
                </button>
              </div>
            </ServerActionForm>
          </div>
        </div>
      ) : null}
      {skippingItem ? (
        <SkipModal
          item={skippingItem}
          recentExpenses={recentExpenses}
          onClose={() => setSkippingId(null)}
        />
      ) : null}
    </>
  );
}

type SkipReason = "skip_once" | "already_logged" | "canceled";

function SkipModal({
  item,
  recentExpenses,
  onClose,
}: {
  item: RecurringTransactionListItem;
  recentExpenses: RecentExpenseOption[];
  onClose: () => void;
}) {
  const [reason, setReason] = useState<SkipReason | null>(null);
  const [logMode, setLogMode] = useState<"auto" | "pick">("auto");
  const [pickedTransactionId, setPickedTransactionId] = useState<string>("");

  const reasonChoices: { id: SkipReason; title: string; hint: string }[] = [
    { id: "skip_once", title: "Skip just this time", hint: "Advance to the next due date without logging anything." },
    {
      id: "already_logged",
      title: "It's already in the expense log",
      hint: "Link the existing expense, then advance to the next due date.",
    },
    { id: "canceled", title: "Canceled subscription", hint: "Stop tracking this subscription entirely." },
  ];

  return (
    <div className={`fixed inset-0 ${MOBILE_OVERLAY_ROOT_Z_CLASS} flex items-center justify-center bg-black/60 p-3`}>
      <div className="max-h-[min(92vh,44rem)] w-full max-w-lg overflow-y-auto rounded-2xl border border-slate-700 bg-slate-950 p-4 shadow-2xl">
        <h3 className="text-lg font-semibold text-slate-100">Skip {item.name}</h3>
        <p className="mt-1 text-sm text-slate-400">
          Due {item.nextExpectedDateDisplay}. Why are you skipping this one?
        </p>

        <div className="mt-3 space-y-2">
          {reasonChoices.map((choice) => (
            <button
              key={choice.id}
              type="button"
              onClick={() => setReason(choice.id)}
              className={`block w-full rounded-xl border px-3 py-2.5 text-left transition ${
                reason === choice.id
                  ? "border-blue-400 bg-blue-500/15 text-slate-50"
                  : "border-slate-700 bg-slate-900/60 text-slate-200 hover:border-slate-600"
              }`}
            >
              <span className="block text-sm font-medium">{choice.title}</span>
              <span className="mt-0.5 block text-xs text-slate-400">{choice.hint}</span>
            </button>
          ))}
        </div>

        {reason === "already_logged" ? (
          <div className="mt-3 space-y-2 rounded-xl border border-slate-800 bg-slate-950/50 p-3">
            <label className="flex items-start gap-2 text-sm text-slate-200">
              <input
                type="radio"
                name="logMode"
                checked={logMode === "auto"}
                onChange={() => setLogMode("auto")}
                className="mt-1"
              />
              <span>
                Auto-match by title
                <span className="mt-0.5 block text-xs text-slate-400">
                  Finds an unlinked expense titled “{item.name}” near {item.nextExpectedDateDisplay}.
                </span>
              </span>
            </label>
            <label className="flex items-start gap-2 text-sm text-slate-200">
              <input
                type="radio"
                name="logMode"
                checked={logMode === "pick"}
                onChange={() => setLogMode("pick")}
                className="mt-1"
              />
              <span className="flex-1">
                Pick the transaction
                {logMode === "pick" ? (
                  <select
                    value={pickedTransactionId}
                    onChange={(event) => setPickedTransactionId(event.target.value)}
                    className={`${selectClass} mt-2`}
                  >
                    <option value="">Select an expense…</option>
                    {recentExpenses.map((expense) => (
                      <option key={expense.id} value={expense.id}>
                        {expense.dateDisplay} · {formatCurrency(expense.amountCents)} · {expense.title || "Untitled"}
                      </option>
                    ))}
                  </select>
                ) : null}
              </span>
            </label>
            {recentExpenses.length === 0 ? (
              <p className="text-xs text-slate-500">No recent unlinked expenses found to pick from.</p>
            ) : null}
          </div>
        ) : null}

        {reason === "canceled" ? (
          <p className="mt-3 rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-100">
            This removes the subscription and stops all future reminders. Past transactions stay in your log.
          </p>
        ) : null}

        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <button type="button" className={secondaryBtnClass} onClick={onClose}>
            Cancel
          </button>
          {reason === "skip_once" ? (
            <ServerActionForm action={skipRecurringOccurrenceAction} onSuccess={onClose}>
              <input type="hidden" name="recurringTransactionId" value={item.id} />
              <input type="hidden" name="expectedDate" value={item.nextExpectedDateYmd} />
              <input type="hidden" name="reason" value="skip_once" />
              <button type="submit" className={primaryBtnClass}>
                Skip this occurrence
              </button>
            </ServerActionForm>
          ) : null}
          {reason === "already_logged" ? (
            <ServerActionForm action={skipRecurringOccurrenceAction} onSuccess={onClose}>
              <input type="hidden" name="recurringTransactionId" value={item.id} />
              <input type="hidden" name="expectedDate" value={item.nextExpectedDateYmd} />
              <input type="hidden" name="reason" value="already_logged" />
              {logMode === "pick" && pickedTransactionId ? (
                <input type="hidden" name="transactionId" value={pickedTransactionId} />
              ) : null}
              <button
                type="submit"
                className={`${primaryBtnClass} disabled:pointer-events-none disabled:opacity-50`}
                disabled={logMode === "pick" && !pickedTransactionId}
              >
                Link &amp; advance
              </button>
            </ServerActionForm>
          ) : null}
          {reason === "canceled" ? (
            <ServerActionForm action={deleteRecurringTransactionAction} onSuccess={onClose}>
              <input type="hidden" name="recurringTransactionId" value={item.id} />
              <button
                type="submit"
                className="touch-manipulation rounded-xl bg-red-500 px-3 py-2 text-sm font-medium text-white transition hover:bg-red-400"
              >
                Remove subscription
              </button>
            </ServerActionForm>
          ) : null}
        </div>
      </div>
    </div>
  );
}
