"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import {
  contributeToSavingsGoalAction,
  createSavingsGoalAction,
  deleteSavingsGoalAction,
  updateSavingsGoalAction,
} from "@/app/actions";
import { SavingsGoalProgress, goalSubtitle } from "@/components/savings-goal-progress";
import { CurrencyAmountInput, DateField, inputClass, primaryBtnClass, secondaryBtnClass, selectClass } from "@/components/forms/shared";
import { ServerActionForm } from "@/components/server-action-form";
import { FormDialog, useConfirm } from "@/components/settings/dialog";
import { formatAccountTypeLabel } from "@/lib/account-type-labels";
import type { GoalAccountOption, SavingsGoalView } from "@/lib/savings-goals-data";
import { MAX_GOAL_NAME_LENGTH } from "@/lib/savings-goals";

const smallBtnClass =
  "touch-manipulation rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs font-medium text-slate-200 transition hover:bg-slate-800";

const centsToInput = (cents: number) => (cents / 100).toFixed(2);

type Dialog = { kind: "new" } | { kind: "edit"; goal: SavingsGoalView } | { kind: "add"; goal: SavingsGoalView } | null;

export function SavingsGoalsPanel({ goals, accounts }: { goals: SavingsGoalView[]; accounts: GoalAccountOption[] }) {
  const [dialog, setDialog] = useState<Dialog>(null);
  const confirm = useConfirm();
  const close = () => setDialog(null);
  return (
    <div className="space-y-4" data-testid="savings-goals">
      {confirm.dialog}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-prose text-sm text-slate-400">
          Link a goal to the account you&apos;re saving in and its balance is the progress, from your bank or the balances
          you enter under Accounts. Without an account, record what you&apos;ve put aside yourself. Goals show on Insights.
        </p>
        <button type="button" className={primaryBtnClass} onClick={() => setDialog({ kind: "new" })}>
          <Plus className="mr-1 h-4 w-4" aria-hidden />
          New goal
        </button>
      </div>

      {goals.length === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-700 px-3 py-4 text-sm text-slate-400">No goals yet.</p>
      ) : (
        <ul className="divide-y divide-slate-800 overflow-hidden rounded-xl border border-slate-800 bg-slate-900/50">
          {goals.map((goal) => (
            <li key={goal.id} className="space-y-2.5 px-4 py-3" data-testid="savings-goal-row">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-slate-100">{goal.name}</p>
                  <p className="text-xs text-slate-400">{goalSubtitle(goal)}</p>
                </div>
                <div className="flex gap-1.5">
                  {goal.account ? null : (
                    <button
                      type="button"
                      className={smallBtnClass}
                      onClick={() => setDialog({ kind: "add", goal })}
                      aria-label={`Add money to ${goal.name}`}
                    >
                      Add money
                    </button>
                  )}
                  <button
                    type="button"
                    className={smallBtnClass}
                    onClick={() => setDialog({ kind: "edit", goal })}
                    aria-label={`Edit ${goal.name}`}
                  >
                    Edit
                  </button>
                  <ServerActionForm
                    action={deleteSavingsGoalAction}
                    beforeSubmit={() =>
                      confirm.ask({
                        title: `Delete the goal “${goal.name}”?`,
                        body: goal.account
                          ? "The account and its balances are kept."
                          : "What you recorded as saved toward it goes with it.",
                        confirmLabel: "Delete goal",
                        danger: true,
                      })
                    }
                  >
                    <input type="hidden" name="goalId" value={goal.id} />
                    <button type="submit" className={`${smallBtnClass} text-red-200`} aria-label={`Delete ${goal.name}`}>
                      Delete
                    </button>
                  </ServerActionForm>
                </div>
              </div>
              <SavingsGoalProgress goal={goal} />
            </li>
          ))}
        </ul>
      )}

      {dialog?.kind === "new" ? (
        <FormDialog title="New savings goal" onClose={close}>
          <GoalForm accounts={accounts} onDone={close} />
        </FormDialog>
      ) : null}
      {dialog?.kind === "edit" ? (
        <FormDialog title={`Edit “${dialog.goal.name}”`} onClose={close}>
          <GoalForm goal={dialog.goal} accounts={accounts} onDone={close} />
        </FormDialog>
      ) : null}
      {dialog?.kind === "add" ? (
        <FormDialog title={`Add money to “${dialog.goal.name}”`} onClose={close}>
          <ServerActionForm action={contributeToSavingsGoalAction} onSuccess={close} className="space-y-4">
            <input type="hidden" name="goalId" value={dialog.goal.id} />
            <CurrencyAmountInput name="amount" label="Amount" placeholder="0.00" required />
            <p className="text-xs text-slate-400">Enter a negative amount to take money back out.</p>
            <div className="flex justify-end gap-2">
              <button type="button" className={secondaryBtnClass} onClick={close}>
                Cancel
              </button>
              <button type="submit" className={primaryBtnClass}>
                Add
              </button>
            </div>
          </ServerActionForm>
        </FormDialog>
      ) : null}
    </div>
  );
}

function GoalForm({
  goal,
  accounts,
  onDone,
}: {
  goal?: SavingsGoalView;
  accounts: GoalAccountOption[];
  onDone: () => void;
}) {
  const [accountId, setAccountId] = useState(goal?.account?.id ?? "");
  // An archived account is not offered for new links, but a goal already on one keeps it.
  const options =
    goal?.account && !accounts.some((a) => a.id === goal.account?.id)
      ? [...accounts, { id: goal.account.id, name: `${goal.account.name} (archived)`, type: "" }]
      : accounts;
  return (
    <ServerActionForm
      action={goal ? updateSavingsGoalAction : createSavingsGoalAction}
      onSuccess={onDone}
      className="space-y-4"
    >
      {goal ? <input type="hidden" name="goalId" value={goal.id} /> : null}
      <label className="block space-y-1.5">
        <span className="text-sm font-medium text-slate-200">Name</span>
        <input
          name="name"
          placeholder="e.g. Emergency fund"
          className={inputClass}
          defaultValue={goal?.name}
          maxLength={MAX_GOAL_NAME_LENGTH}
          required
          autoFocus
        />
      </label>
      <CurrencyAmountInput
        name="target"
        label="Target"
        placeholder="0.00"
        defaultValue={goal ? centsToInput(goal.targetCents) : undefined}
        required
      />
      <DateField
        name="targetDate"
        label="Reach it by (optional)"
        hint="With a date, the goal shows what to put aside each month."
        hintInline
        defaultValue={goal?.targetYmd ?? ""}
      />
      <label className="block space-y-1.5">
        <span className="text-sm font-medium text-slate-200">Saving in</span>
        <select name="accountId" className={selectClass} value={accountId} onChange={(e) => setAccountId(e.target.value)}>
          <option value="">No account (track by hand)</option>
          {options.map((a) => (
            <option key={a.id} value={a.id}>
              {a.type ? `${a.name} (${formatAccountTypeLabel(a.type)})` : a.name}
            </option>
          ))}
        </select>
      </label>
      {accountId ? (
        <p className="text-xs text-slate-400">Progress is this account&apos;s latest balance.</p>
      ) : (
        <CurrencyAmountInput
          name="saved"
          label="Saved so far"
          placeholder="0.00"
          defaultValue={goal ? centsToInput(goal.manualSavedCents) : undefined}
        />
      )}
      <div className="flex justify-end gap-2">
        <button type="button" className={secondaryBtnClass} onClick={onDone}>
          Cancel
        </button>
        <button type="submit" className={primaryBtnClass}>
          {goal ? "Save" : "Add goal"}
        </button>
      </div>
    </ServerActionForm>
  );
}
