"use client";

import { useId, useRef } from "react";
import { ServerActionForm } from "@/components/server-action-form";
import {
  selectClass,
  textAreaClass,
  formGridResponsive,
  spanFullSm,
  primaryBtnClass,
  LabeledField,
  CurrencyAmountInput,
  DateField,
  type Option,
  getTodayIsoDate,
} from "./shared";
import { createTransferAction } from "@/app/actions";
import { useTagOptions } from "@/components/transaction-rules-context";
import { TagInput, type TagInputHandle } from "@/components/tag-input";

/**
 * Records money moved between two of the user's own accounts: a card payment made outside a
 * connected bank, cash taken out, savings topped up. Saved as one transfer, so it stays out of
 * spending, income and budgets, and counts as saved when it lands in a savings account.
 */
export function TransferForm({
  accounts,
  variant = "default",
  onSuccess,
}: {
  accounts: Option[];
  variant?: "default" | "mobileSheet";
  onSuccess?: () => void;
}) {
  const today = getTodayIsoDate();
  const fieldIds = useId();
  const tagOptions = useTagOptions();
  const tagInput = useRef<TagInputHandle>(null);

  if (accounts.length < 2) {
    return (
      <p className="rounded-xl border border-dashed border-slate-700 px-3 py-4 text-sm text-slate-400">
        A transfer moves money between two of your accounts. Add a second account in Settings → Accounts first.
      </p>
    );
  }

  const layout = variant === "mobileSheet" ? "flex flex-col gap-4" : formGridResponsive;

  return (
    <ServerActionForm action={createTransferAction} className={layout} onSuccess={onSuccess}>
      <LabeledField label="From" hint="The account the money left.">
        <select
          id={`${fieldIds}-from`}
          name="fromAccountId"
          aria-label="From account"
          className={selectClass}
          defaultValue={accounts[0]?.id}
        >
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </LabeledField>
      <LabeledField label="To" hint="The account it went to, such as the card you paid.">
        <select
          id={`${fieldIds}-to`}
          name="toAccountId"
          aria-label="To account"
          className={selectClass}
          defaultValue={accounts[1]?.id}
        >
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </LabeledField>
      <div className={spanFullSm}>
        <CurrencyAmountInput name="amount" label="Amount" placeholder="0.00" required />
      </div>
      <div className={spanFullSm}>
        <DateField name="date" label="Transfer date" defaultValue={today} required />
      </div>
      <LabeledField label="Title" hint="Optional (max 120 characters)." className={spanFullSm}>
        <textarea
          name="title"
          rows={2}
          maxLength={120}
          className={textAreaClass}
          placeholder="e.g. Visa payment, savings top-up"
        />
      </LabeledField>
      <LabeledField label="Note" hint="Optional (max 250 characters)." className={spanFullSm}>
        <textarea name="note" rows={3} maxLength={250} className={textAreaClass} placeholder="Additional details" />
      </LabeledField>
      <div className={spanFullSm}>
        <TagInput handleRef={tagInput} suggestions={tagOptions.names} />
      </div>
      <p className={`${spanFullSm} text-xs text-slate-500`}>
        Not counted as spending or income. Listed under Transfers below the expense log.
      </p>
      <button type="submit" className={`${spanFullSm} ${primaryBtnClass} py-2.5 sm:py-2`}>
        Add transfer
      </button>
    </ServerActionForm>
  );
}
