"use client";

import { useId, useState } from "react";
import { createRecurringTransactionAction, updateRecurringTransactionAction } from "@/app/actions";
import { ServerActionForm } from "@/components/server-action-form";
import {
  CurrencyAmountInput,
  DateField,
  LabeledField,
  defaultExpenseAccountSelectValue,
  formGridResponsive,
  getTodayIsoDate,
  inputClass,
  primaryBtnClass,
  secondaryBtnClass,
  selectClass,
  spanFullSm,
  textAreaClass,
  type Option,
} from "@/components/forms/shared";
import { DEFAULT_SEMI_MONTHLY_DAYS, SEMI_MONTHLY_MIN_GAP_DAYS, type SemiMonthlyDays } from "@/lib/recurring-transactions";

/**
 * The one form for creating and editing a recurring rule.
 *
 * Rules used to be edited through four hand-written forms: one to add a rule from the Add menu,
 * one to add a subscription in Settings, and an edit dialog in each of the Recurring card and
 * Settings → Subscriptions. All four wrote the same row through the same two actions, but each
 * was laid out on its own and the edit dialogs had placeholders instead of labels. A field
 * added to a rule had to be added four times; here it is added once.
 */

export type RecurringRuleType = "EXPENSE" | "INCOME" | "TRANSFER";

export type RecurringRuleCadence = "WEEKLY" | "BIWEEKLY" | "MONTHLY" | "QUARTERLY" | "YEARLY" | "BIENNIAL" | "SEMI_MONTHLY";

export const RECURRING_CADENCE_OPTIONS: { value: RecurringRuleCadence; label: string }[] = [
  { value: "WEEKLY", label: "Weekly" },
  { value: "BIWEEKLY", label: "Biweekly" },
  { value: "SEMI_MONTHLY", label: "Twice a month" },
  { value: "MONTHLY", label: "Monthly" },
  { value: "QUARTERLY", label: "Quarterly" },
  { value: "YEARLY", label: "Yearly" },
  { value: "BIENNIAL", label: "Every 2 years" },
];

/** What an existing rule brings to the form when it is being edited. */
export type RecurringRuleValues = {
  id: string;
  type: RecurringRuleType;
  name: string;
  amountCents: number;
  accountId: string;
  categoryId: string;
  /** A transfer rule's other side, the account the money goes to. */
  transferAccountId?: string | null;
  cadence: RecurringRuleCadence;
  /** A twice-a-month rule's days; null on other cadences. */
  semiMonthly?: SemiMonthlyDays | null;
  nextExpectedDateYmd: string;
  endDateYmd: string | null;
  postMode: "REVIEW" | "AUTO";
  note: string | null;
  cancelUrl?: string | null;
  decideByYmd?: string | null;
};

export function RecurringRuleForm({
  rule,
  accounts,
  expenseCategories,
  incomeCategories,
  defaultExpenseAccountId,
  fixedType,
  nameLabel = "Name",
  namePlaceholder = "e.g. Paycheque, rent, gym membership",
  dateLabel = "Next expected date",
  submitLabel,
  onSuccess,
  onCancel,
}: {
  /** The rule being edited. Absent means a new rule. */
  rule?: RecurringRuleValues;
  accounts: Option[];
  expenseCategories: Option[];
  incomeCategories: Option[];
  defaultExpenseAccountId?: string | null;
  /** Hides the type picker and always submits this type, as Subscriptions does for expenses. */
  fixedType?: RecurringRuleType;
  nameLabel?: string;
  namePlaceholder?: string;
  dateLabel?: string;
  submitLabel?: string;
  onSuccess?: () => void;
  /** Shows a Cancel button beside submit, for the form when it sits in a dialog. */
  onCancel?: () => void;
}) {
  const fieldIds = useId();
  const [type, setType] = useState<RecurringRuleType>(fixedType ?? rule?.type ?? "EXPENSE");
  const [cadence, setCadence] = useState<RecurringRuleCadence>(rule?.cadence ?? "MONTHLY");
  const semiMonthly = rule?.semiMonthly ?? DEFAULT_SEMI_MONTHLY_DAYS;
  const transfer = type === "TRANSFER";
  const categories = type === "INCOME" ? incomeCategories : expenseCategories;
  // Switching type swaps the category list; the rule's category only applies to its own type.
  const categoryDefault = rule && rule.type === type ? rule.categoryId : categories[0]?.id;
  const accountDefault = rule?.accountId ?? defaultExpenseAccountSelectValue(accounts, defaultExpenseAccountId);

  return (
    <ServerActionForm
      action={rule ? updateRecurringTransactionAction : createRecurringTransactionAction}
      className={formGridResponsive}
      onSuccess={onSuccess}
    >
      {rule ? <input type="hidden" name="recurringTransactionId" value={rule.id} /> : null}
      {fixedType ? <input type="hidden" name="type" value={fixedType} /> : null}

      <LabeledField label={nameLabel} className={spanFullSm}>
        <input
          id={`${fieldIds}-name`}
          name="name"
          aria-label={nameLabel}
          defaultValue={rule?.name}
          maxLength={80}
          className={inputClass}
          placeholder={namePlaceholder}
          required
        />
      </LabeledField>

      {fixedType ? null : (
        <LabeledField label="Type" hint="Income, an expense, or money moved between your own accounts.">
          <select
            id={`${fieldIds}-type`}
            name="type"
            aria-label="Type"
            className={selectClass}
            value={type}
            onChange={(event) => setType(event.target.value as RecurringRuleType)}
          >
            <option value="EXPENSE">Expense</option>
            <option value="INCOME">Income</option>
            <option value="TRANSFER">Transfer</option>
          </select>
        </LabeledField>
      )}

      <LabeledField label={transfer ? "From account" : "Account"}>
        <select
          id={`${fieldIds}-account`}
          name="accountId"
          aria-label={transfer ? "From account" : "Account"}
          className={selectClass}
          defaultValue={accountDefault}
        >
          {accounts.map((account) => (
            <option key={account.id} value={account.id}>
              {account.name}
            </option>
          ))}
        </select>
      </LabeledField>

      {transfer ? (
        <LabeledField label="To account" hint="Where the money goes. Transfers stay out of income and spending.">
          <select
            id={`${fieldIds}-transfer-account`}
            name="transferAccountId"
            aria-label="To account"
            className={selectClass}
            defaultValue={rule?.transferAccountId ?? accounts.find((a) => a.id !== accountDefault)?.id}
            required
          >
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name}
              </option>
            ))}
          </select>
        </LabeledField>
      ) : (
        <LabeledField label="Category" hint={type === "INCOME" ? "Income category for this deposit." : "Expense category for budgeting."}>
          <select
            // Remounted on a type switch so the default category follows the new list.
            key={type}
            id={`${fieldIds}-category`}
            name="categoryId"
            aria-label="Category"
            className={selectClass}
            defaultValue={categoryDefault}
          >
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        </LabeledField>
      )}

      <CurrencyAmountInput
        name="amount"
        label="Amount each time"
        placeholder="0.00"
        defaultValue={rule ? (rule.amountCents / 100).toFixed(2) : undefined}
        required
      />

      <LabeledField label="Cadence" hint="How often this is expected.">
        <select
          id={`${fieldIds}-cadence`}
          name="cadence"
          aria-label="Cadence"
          className={selectClass}
          value={cadence}
          onChange={(event) => setCadence(event.target.value as RecurringRuleCadence)}
        >
          {RECURRING_CADENCE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </LabeledField>

      {cadence === "SEMI_MONTHLY" ? (
        <>
          <LabeledField label="First day" hint="Day of the month of the first one.">
            <select
              id={`${fieldIds}-first-day`}
              name="firstDay"
              aria-label="First day"
              className={selectClass}
              defaultValue={semiMonthly.day}
            >
              {Array.from({ length: 31 - SEMI_MONTHLY_MIN_GAP_DAYS }, (_, i) => i + 1).map((day) => (
                <option key={day} value={day}>
                  {day}
                </option>
              ))}
            </select>
          </LabeledField>
          <LabeledField label="Second day" hint="At least a week after the first. Short months use their last day.">
            <select
              id={`${fieldIds}-second-day`}
              name="secondDay"
              aria-label="Second day"
              className={selectClass}
              defaultValue={semiMonthly.secondDay}
            >
              {Array.from({ length: 31 - SEMI_MONTHLY_MIN_GAP_DAYS }, (_, i) => i + 1 + SEMI_MONTHLY_MIN_GAP_DAYS).map((day) => (
                <option key={day} value={day}>
                  {day === 31 ? "Last day of the month" : day}
                </option>
              ))}
            </select>
          </LabeledField>
          <label className={`${spanFullSm} flex items-start gap-2 text-sm text-slate-300`}>
            <input
              type="checkbox"
              name="beforeWeekend"
              aria-label="Move to the Friday before a weekend"
              defaultChecked={semiMonthly.beforeWeekend}
              className="mt-1 h-4 w-4 shrink-0 rounded border-slate-600 bg-slate-900 text-blue-500"
            />
            <span>Move to the Friday before when a day lands on a Saturday or Sunday, as most payrolls do.</span>
          </label>
        </>
      ) : null}

      <DateField
        name="nextExpectedDate"
        label={dateLabel}
        hint={cadence === "SEMI_MONTHLY" ? "Starts on the first of the two days on or after this date." : undefined}
        defaultValue={rule?.nextExpectedDateYmd ?? getTodayIsoDate()}
        required
      />
      <DateField name="endDate" label="End date" hint="Optional final expected date." defaultValue={rule?.endDateYmd ?? undefined} />

      <LabeledField label="Posting" hint="Automatic rules are posted to your log as soon as they are due.">
        <select name="postMode" aria-label="Posting" defaultValue={rule?.postMode ?? "REVIEW"} className={selectClass}>
          <option value="REVIEW">Post by hand when due</option>
          <option value="AUTO">Post automatically when due</option>
        </select>
      </LabeledField>

      {type === "EXPENSE" ? (
        <>
          <LabeledField label="Where to cancel" hint="Optional: where to cancel it, a web address or a phone number.">
            <input
              name="cancelUrl"
              aria-label="Where to cancel"
              maxLength={500}
              defaultValue={rule?.cancelUrl ?? ""}
              className={inputClass}
              placeholder="https://… or Call 1-800…"
              autoComplete="off"
            />
          </LabeledField>
          <DateField
            name="decideBy"
            label="Decide by"
            hint="Optional: when a free trial turns paid or a plan renews. Bill reminders warn you before it."
            defaultValue={rule?.decideByYmd ?? undefined}
          />
        </>
      ) : null}

      <LabeledField label="Note" hint="Optional note copied to posted transactions." className={spanFullSm}>
        <textarea
          name="note"
          aria-label="Note"
          rows={2}
          maxLength={250}
          defaultValue={rule?.note ?? ""}
          className={textAreaClass}
          placeholder="Optional details"
        />
      </LabeledField>

      <div className={`${spanFullSm} flex flex-col-reverse gap-2 sm:flex-row sm:justify-end`}>
        {onCancel ? (
          <button type="button" className={secondaryBtnClass} onClick={onCancel}>
            Cancel
          </button>
        ) : null}
        <button type="submit" className={`${primaryBtnClass} py-2.5 sm:py-2`}>
          {submitLabel ?? (rule ? "Save changes" : "Add recurring transaction")}
        </button>
      </div>
    </ServerActionForm>
  );
}
