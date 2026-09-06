"use client";

import { useState } from "react";
import {
  createRecurringTransactionAction,
  createSubscriptionMemberAction,
  deleteRecurringTransactionAction,
  deleteSubscriptionMemberAction,
  setRecurringTransactionEnabledAction,
  setSubscriptionShareStatusAction,
  updateRecurringTransactionAction,
  updateSubscriptionMemberAction,
} from "@/app/actions";
import { ServerActionForm } from "@/components/server-action-form";
import { MetaChip } from "@/components/meta-chip";
import { formatCurrency } from "@/lib/money";
import { MOBILE_OVERLAY_ROOT_Z_CLASS } from "@/lib/mobile-z-index";
import {
  inputClass,
  selectClass,
  textAreaClass,
  primaryBtnClass,
  secondaryBtnClass,
  type Option,
} from "@/components/forms/shared";

export type SubscriptionMemberView = {
  id: string;
  name: string;
  shareCents: number;
  billSent: boolean;
  paid: boolean;
};

export type SubscriptionView = {
  id: string;
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
  note: string | null;
  enabled: boolean;
  postMode: "REVIEW" | "AUTO";
  members: SubscriptionMemberView[];
};

function ToggleStatusButton({
  memberId,
  expectedDate,
  field,
  active,
  label,
}: {
  memberId: string;
  expectedDate: string;
  field: "billSent" | "paid";
  active: boolean;
  label: string;
}) {
  return (
    <ServerActionForm action={setSubscriptionShareStatusAction}>
      <input type="hidden" name="memberId" value={memberId} />
      <input type="hidden" name="expectedDate" value={expectedDate} />
      <input type="hidden" name="field" value={field} />
      <input type="hidden" name="value" value={active ? "false" : "true"} />
      <button
        type="submit"
        aria-pressed={active}
        className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition ${
          active
            ? field === "paid"
              ? "border-emerald-500/45 bg-emerald-500/15 text-emerald-100"
              : "border-blue-500/45 bg-blue-500/15 text-blue-100"
            : "border-slate-700 bg-slate-900 text-slate-300 hover:border-slate-600"
        }`}
      >
        <span aria-hidden>{active ? "✓" : "○"}</span>
        {label}
      </button>
    </ServerActionForm>
  );
}

function MemberRow({ member, expectedDate }: { member: SubscriptionMemberView; expectedDate: string }) {
  const [editing, setEditing] = useState(false);

  if (editing) {
    return (
      <ServerActionForm
        action={updateSubscriptionMemberAction}
        className="flex flex-wrap items-end gap-2 rounded-lg border border-slate-800 bg-slate-950/50 p-2"
        onSuccess={() => setEditing(false)}
      >
        <input type="hidden" name="memberId" value={member.id} />
        <label className="flex-1">
          <span className="mb-1 block text-[10px] uppercase tracking-wide text-slate-500">Name</span>
          <input name="name" defaultValue={member.name} className={inputClass} required />
        </label>
        <label className="w-28">
          <span className="mb-1 block text-[10px] uppercase tracking-wide text-slate-500">Share</span>
          <input
            name="share"
            type="number"
            step="0.01"
            min="0.01"
            defaultValue={(member.shareCents / 100).toFixed(2)}
            className={inputClass}
            required
          />
        </label>
        <button type="submit" className={primaryBtnClass}>
          Save
        </button>
        <button type="button" className={secondaryBtnClass} onClick={() => setEditing(false)}>
          Cancel
        </button>
      </ServerActionForm>
    );
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-800 bg-slate-950/50 p-2">
      <div className="min-w-0">
        <span className="text-sm font-medium text-slate-100">{member.name}</span>
        <span className="ml-2 text-xs tabular-nums text-slate-400">{formatCurrency(member.shareCents)}</span>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <ToggleStatusButton memberId={member.id} expectedDate={expectedDate} field="billSent" active={member.billSent} label="Bill sent" />
        <ToggleStatusButton memberId={member.id} expectedDate={expectedDate} field="paid" active={member.paid} label="Paid" />
        <button type="button" className={secondaryBtnClass} onClick={() => setEditing(true)}>
          Edit
        </button>
        <ServerActionForm action={deleteSubscriptionMemberAction}>
          <input type="hidden" name="memberId" value={member.id} />
          <button type="submit" className={secondaryBtnClass}>
            Remove
          </button>
        </ServerActionForm>
      </div>
    </div>
  );
}

function SubscriptionCard({
  subscription,
  onEdit,
}: {
  subscription: SubscriptionView;
  onEdit: (subscription: SubscriptionView) => void;
}) {
  const paidCents = subscription.members.filter((m) => m.paid).reduce((sum, m) => sum + m.shareCents, 0);
  const sharedCents = subscription.members.reduce((sum, m) => sum + m.shareCents, 0);
  const yourNetCents = subscription.amountCents - paidCents;

  return (
    <div className="space-y-3 rounded-xl border border-slate-800 bg-slate-950/40 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <span className="block font-semibold text-slate-100">{subscription.name}</span>
          {subscription.note ? <span className="mt-0.5 block text-xs text-slate-400">{subscription.note}</span> : null}
        </div>
        <span className="shrink-0 rounded-full border border-blue-500/35 bg-blue-500/15 px-2.5 py-1 text-sm font-semibold tabular-nums text-blue-100">
          {formatCurrency(subscription.amountCents)}
        </span>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {!subscription.enabled ? (
          <span className="rounded-full border border-slate-600 bg-slate-800/70 px-2 py-1 text-xs font-medium text-slate-300">Disabled</span>
        ) : null}
        <MetaChip label="Account">{subscription.accountLabel}</MetaChip>
        <MetaChip label="Category">{subscription.categoryLabel}</MetaChip>
        <MetaChip label="Cadence">{subscription.cadenceLabel}</MetaChip>
        <MetaChip label="Next">{subscription.nextExpectedDateDisplay}</MetaChip>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Shared with</h4>
          {subscription.members.length > 0 ? (
            <span className="text-xs tabular-nums text-slate-400">
              {formatCurrency(paidCents)} paid of {formatCurrency(sharedCents)} shared
            </span>
          ) : null}
        </div>
        {subscription.members.length === 0 ? (
          <p className="text-xs text-slate-500">No one added yet. Add a person below to split this subscription.</p>
        ) : (
          <div className="space-y-1.5">
            {subscription.members.map((member) => (
              <MemberRow key={member.id} member={member} expectedDate={subscription.nextExpectedDateYmd} />
            ))}
          </div>
        )}
        {subscription.members.length > 0 ? (
          <p className="text-xs text-slate-500">
            Your net after credits: <span className="tabular-nums text-slate-300">{formatCurrency(yourNetCents)}</span>. Marking
            someone paid credits their share to this subscription&rsquo;s expense in the log (once it&rsquo;s posted for{" "}
            {subscription.nextExpectedDateDisplay}).
          </p>
        ) : null}

        <ServerActionForm
          action={createSubscriptionMemberAction}
          className="flex flex-wrap items-end gap-2 border-t border-slate-800/80 pt-2"
        >
          <input type="hidden" name="recurringTransactionId" value={subscription.id} />
          <label className="flex-1">
            <span className="mb-1 block text-[10px] uppercase tracking-wide text-slate-500">Add person</span>
            <input name="name" className={inputClass} placeholder="Name" required />
          </label>
          <label className="w-28">
            <span className="mb-1 block text-[10px] uppercase tracking-wide text-slate-500">Their share</span>
            <input name="share" type="number" step="0.01" min="0.01" className={inputClass} placeholder="0.00" required />
          </label>
          <button type="submit" className={primaryBtnClass}>
            Add
          </button>
        </ServerActionForm>
      </div>

      <div className="flex flex-wrap justify-end gap-2 border-t border-slate-800/80 pt-2">
        <button type="button" className={secondaryBtnClass} onClick={() => onEdit(subscription)}>
          Edit subscription
        </button>
        <ServerActionForm action={setRecurringTransactionEnabledAction}>
          <input type="hidden" name="recurringTransactionId" value={subscription.id} />
          <input type="hidden" name="enabled" value={subscription.enabled ? "false" : "true"} />
          <button type="submit" className={secondaryBtnClass}>
            {subscription.enabled ? "Disable" : "Enable"}
          </button>
        </ServerActionForm>
        <ServerActionForm action={deleteRecurringTransactionAction}>
          <input type="hidden" name="recurringTransactionId" value={subscription.id} />
          <button type="submit" className={secondaryBtnClass}>
            Remove
          </button>
        </ServerActionForm>
      </div>
    </div>
  );
}

const cadenceOptions: { value: SubscriptionView["cadence"]; label: string }[] = [
  { value: "WEEKLY", label: "Weekly" },
  { value: "BIWEEKLY", label: "Biweekly" },
  { value: "MONTHLY", label: "Monthly" },
  { value: "QUARTERLY", label: "Quarterly" },
  { value: "YEARLY", label: "Yearly" },
  { value: "BIENNIAL", label: "Every 2 years" },
];

export function SubscriptionsPanel({
  subscriptions,
  accounts,
  expenseCategories,
  defaultExpenseAccountId,
}: {
  subscriptions: SubscriptionView[];
  accounts: Option[];
  expenseCategories: Option[];
  defaultExpenseAccountId: string | null;
}) {
  const [editing, setEditing] = useState<SubscriptionView | null>(null);
  const canCreate = accounts.length > 0 && expenseCategories.length > 0;
  const accountDefault =
    defaultExpenseAccountId && accounts.some((a) => a.id === defaultExpenseAccountId)
      ? defaultExpenseAccountId
      : accounts[0]?.id;

  return (
    <div className="space-y-6">
      <section className="space-y-4 rounded-2xl border border-slate-800 bg-gradient-to-b from-slate-900/90 to-slate-950/80 p-5 shadow-lg sm:p-6">
        <div className="border-b border-slate-800/90 pb-4">
          <h3 className="text-base font-semibold text-slate-100">Add a subscription</h3>
          <p className="mt-2 max-w-prose text-sm text-slate-400">
            Subscriptions are recurring expenses. Add people below each one to split the cost and track who has paid.
          </p>
        </div>
        {canCreate ? (
          <ServerActionForm action={createRecurringTransactionAction} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <input type="hidden" name="type" value="EXPENSE" />
            <label className="sm:col-span-2">
              <span className="mb-1 block text-xs text-slate-400">Name</span>
              <input name="name" className={inputClass} placeholder="e.g. Netflix, internet, gym" required />
            </label>
            <label>
              <span className="mb-1 block text-xs text-slate-400">Account</span>
              <select name="accountId" defaultValue={accountDefault} className={selectClass}>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className="mb-1 block text-xs text-slate-400">Category</span>
              <select name="categoryId" className={selectClass}>
                {expenseCategories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className="mb-1 block text-xs text-slate-400">Amount each time</span>
              <input name="amount" type="number" step="0.01" min="0.01" className={inputClass} placeholder="0.00" required />
            </label>
            <label>
              <span className="mb-1 block text-xs text-slate-400">Cadence</span>
              <select name="cadence" defaultValue="MONTHLY" className={selectClass}>
                {cadenceOptions.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className="mb-1 block text-xs text-slate-400">Next charge date</span>
              <input name="nextExpectedDate" type="date" className={inputClass} required />
            </label>
            <label>
              <span className="mb-1 block text-xs text-slate-400">Posting</span>
              <select name="postMode" defaultValue="REVIEW" className={selectClass}>
                <option value="REVIEW">Post by hand when due</option>
                <option value="AUTO">Post automatically when due</option>
              </select>
            </label>
            <label>
              <span className="mb-1 block text-xs text-slate-400">End date (optional)</span>
              <input name="endDate" type="date" className={inputClass} />
            </label>
            <label className="sm:col-span-2">
              <span className="mb-1 block text-xs text-slate-400">Note (optional)</span>
              <textarea name="note" rows={2} maxLength={250} className={textAreaClass} placeholder="Optional details" />
            </label>
            <button type="submit" className={`${primaryBtnClass} py-2.5 sm:col-span-2 sm:py-2`}>
              Add subscription
            </button>
          </ServerActionForm>
        ) : (
          <p className="text-sm text-slate-400">
            Add at least one account and one expense category first (in Import &amp; accounts and Budgets) before creating a
            subscription.
          </p>
        )}
      </section>

      <section className="space-y-3">
        <h3 className="text-base font-semibold text-slate-100">Your subscriptions</h3>
        {subscriptions.length === 0 ? (
          <p className="text-sm text-slate-400">No subscriptions yet.</p>
        ) : (
          <div className="space-y-3">
            {subscriptions.map((subscription) => (
              <SubscriptionCard key={subscription.id} subscription={subscription} onEdit={setEditing} />
            ))}
          </div>
        )}
      </section>

      {editing ? (
        <div className={`fixed inset-0 ${MOBILE_OVERLAY_ROOT_Z_CLASS} flex items-center justify-center bg-black/60 p-3`}>
          <div className="max-h-[min(92vh,44rem)] w-full max-w-lg overflow-y-auto rounded-2xl border border-slate-700 bg-slate-950 p-4 shadow-2xl">
            <h3 className="text-lg font-semibold text-slate-100">Edit subscription</h3>
            <ServerActionForm
              action={updateRecurringTransactionAction}
              className="mt-3 space-y-3"
              onSuccess={() => setEditing(null)}
            >
              <input type="hidden" name="recurringTransactionId" value={editing.id} />
              <input type="hidden" name="type" value="EXPENSE" />
              <input name="name" defaultValue={editing.name} className={inputClass} placeholder="Name" required />
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <select name="accountId" defaultValue={editing.accountId} className={selectClass}>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
                <select name="categoryId" defaultValue={editing.categoryId} className={selectClass}>
                  {expenseCategories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
                <input
                  name="amount"
                  type="number"
                  step="0.01"
                  min="0.01"
                  defaultValue={(editing.amountCents / 100).toFixed(2)}
                  className={inputClass}
                  required
                />
                <select name="cadence" defaultValue={editing.cadence} className={selectClass}>
                  {cadenceOptions.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </select>
                <input name="nextExpectedDate" type="date" defaultValue={editing.nextExpectedDateYmd} className={inputClass} required />
                <input name="endDate" type="date" defaultValue={editing.endDateYmd ?? ""} className={inputClass} aria-label="Optional end date" />
                <select name="postMode" defaultValue={editing.postMode} className={selectClass} aria-label="Posting">
                  <option value="REVIEW">Post by hand when due</option>
                  <option value="AUTO">Post automatically when due</option>
                </select>
              </div>
              <textarea name="note" defaultValue={editing.note ?? ""} className={textAreaClass} placeholder="Optional note" maxLength={250} />
              <div className="flex justify-end gap-2">
                <button type="button" className={secondaryBtnClass} onClick={() => setEditing(null)}>
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
    </div>
  );
}
