"use client";

import type { SemiMonthlyDays } from "@/lib/recurring-transactions";
import { useState } from "react";
import {
  createSubscriptionMemberAction,
  deleteRecurringTransactionAction,
  deleteSubscriptionMemberAction,
  setRecurringTransactionEnabledAction,
  setSubscriptionShareStatusAction,
  updateSubscriptionMemberAction,
} from "@/app/actions";
import { ServerActionForm } from "@/components/server-action-form";
import { MetaChip } from "@/components/meta-chip";
import { formatCurrency } from "@/lib/money";
import { MOBILE_OVERLAY_ROOT_Z_CLASS } from "@/lib/mobile-z-index";
import { RecurringRuleForm } from "@/components/recurring-rule-form";
import { FormDialog } from "@/components/settings/dialog";
import { Plus } from "lucide-react";
import {
  inputClass,
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
  cadence: "WEEKLY" | "BIWEEKLY" | "MONTHLY" | "QUARTERLY" | "YEARLY" | "BIENNIAL" | "SEMI_MONTHLY";
  cadenceLabel: string;
  /** A twice-a-month rule's days; null on other cadences. */
  semiMonthly?: SemiMonthlyDays | null;
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
    <div className="space-y-2.5 rounded-xl border border-slate-800 bg-slate-950/40 p-2.5">
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
  const [adding, setAdding] = useState(false);
  const canCreate = accounts.length > 0 && expenseCategories.length > 0;

  return (
    <div className="space-y-6">
      <section className="space-y-3" aria-label="Your subscriptions">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="max-w-prose text-sm text-slate-400">
            Add people to a subscription to split its cost and track who has paid. Post or skip each charge from the
            dashboard.
          </p>
          <button
            type="button"
            className={primaryBtnClass}
            onClick={() => setAdding(true)}
            disabled={!canCreate}
            title={canCreate ? undefined : "Add an account and an expense category first."}
          >
            <Plus className="mr-1 h-4 w-4" aria-hidden />
            New subscription
          </button>
        </div>
        {subscriptions.length === 0 ? (
          <p className="rounded-xl border border-dashed border-slate-700 px-4 py-6 text-center text-sm text-slate-500">
            No subscriptions yet.
          </p>
        ) : (
          <div className="space-y-3">
            {subscriptions.map((subscription) => (
              <SubscriptionCard key={subscription.id} subscription={subscription} onEdit={setEditing} />
            ))}
          </div>
        )}
      </section>

      {adding ? (
        <FormDialog title="New subscription" onClose={() => setAdding(false)} wide>
          <RecurringRuleForm
            accounts={accounts}
            expenseCategories={expenseCategories}
            incomeCategories={[]}
            defaultExpenseAccountId={defaultExpenseAccountId}
            fixedType="EXPENSE"
            namePlaceholder="e.g. Netflix, internet, gym"
            dateLabel="Next charge date"
            submitLabel="Add subscription"
            onSuccess={() => setAdding(false)}
            onCancel={() => setAdding(false)}
          />
        </FormDialog>
      ) : null}

      {editing ? (
        <div className={`fixed inset-0 ${MOBILE_OVERLAY_ROOT_Z_CLASS} flex items-center justify-center bg-black/60 p-3`}>
          <div className="max-h-[min(92vh,44rem)] w-full max-w-lg overflow-y-auto rounded-2xl border border-slate-700 bg-slate-950 p-4 shadow-2xl">
            <h3 className="text-lg font-semibold text-slate-100">Edit subscription</h3>
            <div className="mt-3">
              <RecurringRuleForm
                rule={{ ...editing, type: "EXPENSE" }}
                accounts={accounts}
                expenseCategories={expenseCategories}
                incomeCategories={[]}
                fixedType="EXPENSE"
                dateLabel="Next charge date"
                onSuccess={() => setEditing(null)}
                onCancel={() => setEditing(null)}
              />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
