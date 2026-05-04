"use client";

import { useState } from "react";
import { deleteSubscriptionAction, updateSubscriptionAction } from "@/app/actions";
import { MetaChip } from "@/components/meta-chip";
import { formatCurrency } from "@/lib/money";

export type SubscriptionListItem = {
  id: string;
  name: string;
  amountCents: number;
  accountId: string;
  accountLabel: string;
  categoryId: string;
  categoryLabel: string;
  billingCycle: "WEEKLY" | "MONTHLY" | "QUARTERLY" | "YEARLY" | "BIENNIAL";
  billingCycleLabel: string;
  nextChargeDateYmd: string;
  nextChargeDateDisplay: string;
};

type Option = { id: string; name: string };

const inputClass =
  "w-full min-h-[2.75rem] rounded-xl border border-slate-700 bg-slate-950/70 px-3 py-2.5 text-base leading-normal text-slate-100 placeholder:text-slate-500 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-500/20 sm:text-sm";
const selectClass =
  "w-full min-h-[2.75rem] rounded-xl border border-slate-700 bg-slate-950/70 px-3 py-2.5 text-base text-slate-100 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-500/20 sm:text-sm";
const primaryBtnClass =
  "touch-manipulation rounded-xl bg-blue-500 px-3 py-2 text-sm font-medium text-white transition hover:bg-blue-400";
const secondaryBtnClass =
  "touch-manipulation rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm font-medium text-slate-200 transition hover:border-slate-600 hover:bg-slate-800";

export function SubscriptionsPanel({
  items,
  accounts,
  expenseCategories,
}: {
  items: SubscriptionListItem[];
  accounts: Option[];
  expenseCategories: Option[];
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const editingItem = items.find((item) => item.id === editingId) ?? null;

  if (items.length === 0) {
    return (
      <p className="text-sm text-slate-400">
        No subscriptions yet. Add one from the{" "}
        <span className="rounded-md border border-slate-700 bg-slate-800/60 px-1.5 py-0.5 text-xs font-medium text-slate-200">
          Add
        </span>{" "}
        menu.
      </p>
    );
  }

  return (
    <>
      <div className="max-h-[min(56vh,32rem)] space-y-2 overflow-y-auto pr-1">
        {items.map((sub) => (
          <div
            key={sub.id}
            className="rounded-xl border border-slate-800 bg-slate-950/50 p-2.5 text-left text-sm text-slate-100"
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <span className="min-w-0 flex-1 font-semibold leading-snug text-slate-100">{sub.name}</span>
              <span className="shrink-0 rounded-full border border-blue-500/35 bg-blue-500/15 px-2.5 py-1 text-sm font-semibold tabular-nums text-blue-100">
                {formatCurrency(sub.amountCents)}
              </span>
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <MetaChip label="Category">{sub.categoryLabel}</MetaChip>
              <MetaChip label="Account">{sub.accountLabel}</MetaChip>
              <MetaChip label="Billing">{sub.billingCycleLabel}</MetaChip>
              <MetaChip label="Next">{sub.nextChargeDateDisplay}</MetaChip>
            </div>
            <div className="mt-3 flex justify-end gap-2">
              <button type="button" className={secondaryBtnClass} onClick={() => setEditingId(sub.id)}>
                Edit
              </button>
              <form action={deleteSubscriptionAction}>
                <input type="hidden" name="subscriptionId" value={sub.id} />
                <button type="submit" className={secondaryBtnClass}>
                  Remove
                </button>
              </form>
            </div>
          </div>
        ))}
      </div>
      {editingItem ? (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-3">
          <div className="w-full max-w-lg rounded-2xl border border-slate-700 bg-slate-950 p-4 shadow-2xl">
            <h3 className="text-lg font-semibold text-slate-100">Edit subscription</h3>
            <form action={updateSubscriptionAction} className="mt-3 space-y-3">
              <input type="hidden" name="subscriptionId" value={editingItem.id} />
              <input name="name" defaultValue={editingItem.name} className={inputClass} placeholder="Subscription name" required />
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <select name="accountId" defaultValue={editingItem.accountId} className={selectClass}>
                  {accounts.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.name}
                    </option>
                  ))}
                </select>
                <select name="categoryId" defaultValue={editingItem.categoryId} className={selectClass}>
                  {expenseCategories.map((category) => (
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
                <select name="billingCycle" defaultValue={editingItem.billingCycle} className={selectClass}>
                  <option value="WEEKLY">Weekly</option>
                  <option value="MONTHLY">Monthly</option>
                  <option value="QUARTERLY">Quarterly</option>
                  <option value="YEARLY">Yearly</option>
                  <option value="BIENNIAL">Every 2 years</option>
                </select>
              </div>
              <input
                name="nextChargeDate"
                type="date"
                defaultValue={editingItem.nextChargeDateYmd}
                className={inputClass}
                required
              />
              <div className="flex justify-end gap-2">
                <button type="button" className={secondaryBtnClass} onClick={() => setEditingId(null)}>
                  Cancel
                </button>
                <button type="submit" className={primaryBtnClass}>
                  Save changes
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </>
  );
}
