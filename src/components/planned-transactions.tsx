"use client";

import { useId, useRef, useState } from "react";
import {
  createPlannedTransactionAction,
  deletePlannedTransactionAction,
  recordPlannedTransactionAction,
  updatePlannedTransactionAction,
} from "@/app/actions";
import {
  CurrencyAmountInput,
  DateField,
  formGridResponsive,
  LabeledField,
  inputClass,
  primaryBtnClass,
  selectClass,
  spanFullSm,
  textAreaClass,
  type Option,
} from "@/components/forms/shared";
import { ServerActionForm } from "@/components/server-action-form";
import { FormDialog, useConfirm } from "@/components/settings/dialog";
import { formatCurrency } from "@/lib/money";

export type PlannedItem = {
  id: string;
  type: "EXPENSE" | "INCOME";
  name: string;
  amountCents: number;
  dateYmd: string;
  dateDisplay: string;
  accountId: string;
  accountName: string;
  categoryId: string;
  categoryName: string;
  note: string | null;
  /** Its date has passed with nothing in the log matching it. */
  pastDue: boolean;
};

const smallBtn =
  "touch-manipulation rounded-lg border border-slate-700 px-2 py-1 text-xs font-medium text-slate-200 transition hover:bg-slate-800";

/** Plan a one-off expense or income, or change one (`plan`). */
export function PlanForm({
  accounts,
  expenseCategories,
  incomeCategories,
  plan,
  onSuccess,
}: {
  accounts: Option[];
  expenseCategories: Option[];
  incomeCategories: Option[];
  plan?: PlannedItem;
  onSuccess?: () => void;
}) {
  const fieldIds = useId();
  const [type, setType] = useState<"EXPENSE" | "INCOME">(plan?.type ?? "EXPENSE");
  const categories = type === "INCOME" ? incomeCategories : expenseCategories;

  if (accounts.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-slate-700 px-3 py-4 text-sm text-slate-400">
        Add an account in Settings → Accounts first.
      </p>
    );
  }

  return (
    <ServerActionForm
      action={plan ? updatePlannedTransactionAction : createPlannedTransactionAction}
      className={formGridResponsive}
      onSuccess={onSuccess}
    >
      {plan ? <input type="hidden" name="planId" value={plan.id} /> : null}
      <LabeledField label="Kind" className={spanFullSm}>
        <select
          id={`${fieldIds}-type`}
          name="type"
          aria-label="Kind"
          className={selectClass}
          value={type}
          onChange={(e) => setType(e.target.value === "INCOME" ? "INCOME" : "EXPENSE")}
        >
          <option value="EXPENSE">Expense</option>
          <option value="INCOME">Income</option>
        </select>
      </LabeledField>
      <LabeledField label="What" hint="For example: car repair, tax refund, vacation." className={spanFullSm}>
        <input
          name="name"
          aria-label="What"
          required
          maxLength={120}
          defaultValue={plan?.name}
          className={inputClass}
          placeholder="e.g. Winter tires"
        />
      </LabeledField>
      <CurrencyAmountInput
        name="amount"
        label="Amount"
        placeholder="0.00"
        required
        defaultValue={plan ? (plan.amountCents / 100).toFixed(2) : undefined}
      />
      <DateField name="date" label="Expected on" defaultValue={plan?.dateYmd} required />
      <LabeledField label="Account">
        <select
          id={`${fieldIds}-account`}
          name="accountId"
          aria-label="Account"
          className={selectClass}
          defaultValue={plan?.accountId ?? accounts[0]?.id}
        >
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </LabeledField>
      <LabeledField label="Category">
        <select
          // Remounted when the kind changes, so it starts on a category of that kind.
          key={type}
          id={`${fieldIds}-category`}
          name="categoryId"
          aria-label="Category"
          className={selectClass}
          defaultValue={plan?.type === type ? plan.categoryId : categories[0]?.id}
        >
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </LabeledField>
      <LabeledField label="Note" hint="Optional (max 250 characters)." className={spanFullSm}>
        <textarea name="note" rows={2} maxLength={250} defaultValue={plan?.note ?? ""} className={textAreaClass} />
      </LabeledField>
      <p className={`${spanFullSm} text-xs text-slate-500`}>
        Shown in Upcoming bills, the Calendar, Safe to spend and projected balances until it happens. When the real
        entry reaches the log, typed, imported or from your bank, the plan is marked done.
      </p>
      <button type="submit" className={`${spanFullSm} ${primaryBtnClass} py-2.5 sm:py-2`}>
        {plan ? "Save plan" : "Add plan"}
      </button>
    </ServerActionForm>
  );
}

/** The plan's buttons for "Did this happen?": add it to the log, or drop it. */
function PastDueActions({ plan }: { plan: PlannedItem }) {
  const { ask, dialog } = useConfirm();
  const dropForm = useRef<HTMLFormElement>(null);
  return (
    <span className="flex flex-wrap gap-1.5">
      <ServerActionForm action={recordPlannedTransactionAction}>
        <input type="hidden" name="planId" value={plan.id} />
        <button type="submit" className={smallBtn}>
          Yes, add it
        </button>
      </ServerActionForm>
      <ServerActionForm action={deletePlannedTransactionAction} ref={dropForm}>
        <input type="hidden" name="planId" value={plan.id} />
        <button
          type="button"
          className={smallBtn}
          onClick={async () => {
            const ok = await ask({
              title: "Remove this plan?",
              body: `“${plan.name}” comes out of your forecasts. Nothing in your log changes.`,
              confirmLabel: "Remove plan",
              danger: true,
            });
            if (ok) dropForm.current?.requestSubmit();
          }}
        >
          No, remove it
        </button>
      </ServerActionForm>
      {dialog}
    </span>
  );
}

function signedAmount(plan: PlannedItem) {
  return `${plan.type === "INCOME" ? "+" : "-"}${formatCurrency(plan.amountCents)}`;
}

/** "Did this happen?" for plans whose date has passed with nothing matching them. */
export function PlannedPastDuePrompt({ plans }: { plans: PlannedItem[] }) {
  if (plans.length === 0) return null;
  return (
    <div className="mb-3 space-y-2 rounded-xl border border-amber-500/40 bg-amber-950/30 p-2.5" data-planned-past-due>
      <p className="text-xs font-semibold text-amber-100">Did this happen?</p>
      <ul className="space-y-2">
        {plans.map((plan) => (
          <li key={plan.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span className="min-w-0">
              <span className="font-medium text-slate-100">{plan.name}</span>{" "}
              <span className="text-xs text-slate-400">
                {signedAmount(plan)} planned for {plan.dateDisplay}
              </span>
            </span>
            <PastDueActions plan={plan} />
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The Plan tab's list: every open plan, to change or remove. */
export function PlannedList({
  plans,
  accounts,
  expenseCategories,
  incomeCategories,
}: {
  plans: PlannedItem[];
  accounts: Option[];
  expenseCategories: Option[];
  incomeCategories: Option[];
}) {
  const [editing, setEditing] = useState<PlannedItem | null>(null);
  const { ask, dialog } = useConfirm();
  const removeForms = useRef(new Map<string, HTMLFormElement>());
  if (plans.length === 0) return null;
  return (
    <section className="mt-4" aria-label="Your plans">
      <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">Your plans</h3>
      <PlannedPastDuePrompt plans={plans.filter((p) => p.pastDue)} />
      <ul className="space-y-1.5">
        {plans
          .filter((p) => !p.pastDue)
          .map((plan) => (
            <li
              key={plan.id}
              className="flex items-center justify-between gap-2 rounded-xl border border-slate-800 bg-slate-950/50 px-2.5 py-2 text-sm"
              data-planned-item={plan.id}
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium text-slate-100">{plan.name}</span>
                <span className="text-xs text-slate-400">
                  {plan.dateDisplay} · {plan.accountName} · {plan.categoryName}
                </span>
              </span>
              <span
                className={`shrink-0 tabular-nums font-semibold ${plan.type === "INCOME" ? "text-emerald-200" : "text-blue-100"}`}
              >
                {signedAmount(plan)}
              </span>
              <span className="flex shrink-0 gap-1">
                <button type="button" className={smallBtn} onClick={() => setEditing(plan)}>
                  Edit
                </button>
                <ServerActionForm
                  action={deletePlannedTransactionAction}
                  ref={(form) => {
                    if (form) removeForms.current.set(plan.id, form);
                    else removeForms.current.delete(plan.id);
                  }}
                >
                  <input type="hidden" name="planId" value={plan.id} />
                  <button
                    type="button"
                    className={smallBtn}
                    onClick={async () => {
                      const ok = await ask({
                        title: "Remove this plan?",
                        body: `“${plan.name}” comes out of your forecasts.`,
                        confirmLabel: "Remove plan",
                        danger: true,
                      });
                      if (ok) removeForms.current.get(plan.id)?.requestSubmit();
                    }}
                  >
                    Remove
                  </button>
                </ServerActionForm>
              </span>
            </li>
          ))}
      </ul>
      {editing ? (
        <FormDialog title="Change plan" onClose={() => setEditing(null)}>
          <PlanForm
            accounts={accounts}
            expenseCategories={expenseCategories}
            incomeCategories={incomeCategories}
            plan={editing}
            onSuccess={() => setEditing(null)}
          />
        </FormDialog>
      ) : null}
      {dialog}
      <p className="mt-2 text-[11px] text-slate-500">
        A plan is done when an entry on its account arrives from a week before to two weeks after its date, for the
        same amount, or in the same category and within 10% of it.
      </p>
    </section>
  );
}

type PlansPanelProps = {
  plans: PlannedItem[];
  accounts: Option[];
  expenseCategories: Option[];
  incomeCategories: Option[];
};

/** Plan a one-off, with the open plans below: the Add card's Plan tab and the Plan dialog. */
export function PlansPanel({ plans, accounts, expenseCategories, incomeCategories, onAdded }: PlansPanelProps & { onAdded?: () => void }) {
  return (
    <>
      <PlanForm
        accounts={accounts}
        expenseCategories={expenseCategories}
        incomeCategories={incomeCategories}
        onSuccess={onAdded}
      />
      <PlannedList plans={plans} accounts={accounts} expenseCategories={expenseCategories} incomeCategories={incomeCategories} />
    </>
  );
}

/**
 * The Upcoming bills card's "Plan" button. Phones have no Add card, so this is where they plan
 * a one-off and see their plans; on a wide screen it is the shortcut beside the forecast.
 */
export function PlansDialogButton(props: PlansPanelProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={smallBtn} onClick={() => setOpen(true)} aria-label="Plan a one-off expense or income">
        + Plan
      </button>
      {open ? (
        <FormDialog title="Plan a one-off" onClose={() => setOpen(false)} wide>
          <PlansPanel {...props} onAdded={() => setOpen(false)} />
        </FormDialog>
      ) : null}
    </>
  );
}
