"use client";

import { useId, useRef, type FocusEvent } from "react";
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
import { createIncomeAction } from "@/app/actions";
import { RuleAutofillHint, useRuleAutofill, useTagOptions } from "@/components/transaction-rules-context";
import { TagInput, type TagInputHandle } from "@/components/tag-input";

export function IncomeForm({
  accounts,
  incomeCategories,
  variant = "default",
  onSuccess,
}: {
  accounts: Option[];
  incomeCategories: Option[];
  variant?: "default" | "mobileSheet";
  onSuccess?: () => void;
}) {
  const today = getTodayIsoDate();
  const fieldIds = useId();

  const rules = useRuleAutofill({ type: "INCOME", categoryOptions: incomeCategories });
  const tagOptions = useTagOptions();
  const tagInput = useRef<TagInputHandle>(null);

  /**
   * Every field here is uncontrolled, so rules write to the form directly. They run when the
   * title is left — the last thing entered in either layout — and only fill the amount and
   * note while those are empty; account, source and title follow the rule, and its tags are added.
   */
  function applyRules(e: FocusEvent<HTMLTextAreaElement>) {
    const form = e.currentTarget.form;
    if (!form) return;
    const field = <T extends Element>(name: string) => form.elements.namedItem(name) as T | null;
    const title = e.currentTarget.value;
    const amount = field<HTMLInputElement>("amount");
    const account = field<HTMLSelectElement>("accountId");
    const amountNumber = Number(amount?.value);
    const { outcome, fresh } = rules.evaluate({
      texts: [title],
      amountCents: amount?.value.trim() && Number.isFinite(amountNumber) ? Math.round(amountNumber * 100) : null,
      accountId: account?.value || null,
    });
    if (!fresh) return;
    const category = field<HTMLSelectElement>("categoryId");
    if (outcome.categoryId && category && incomeCategories.some((c) => c.id === outcome.categoryId)) {
      category.value = outcome.categoryId;
    }
    if (outcome.accountId && account && accounts.some((a) => a.id === outcome.accountId)) {
      account.value = outcome.accountId;
    }
    if (outcome.amountCents !== undefined && amount && !amount.value.trim()) {
      amount.value = (outcome.amountCents / 100).toFixed(2);
    }
    const note = field<HTMLTextAreaElement>("note");
    if (outcome.appendNote && note && !note.value.trim()) note.value = outcome.appendNote;
    tagInput.current?.add(tagOptions.namesFor(outcome.tagIds));
    if (outcome.title) e.currentTarget.value = outcome.title;
  }

  const layout = variant === "mobileSheet" ? "flex flex-col gap-4" : formGridResponsive;

  const oAcct = variant === "mobileSheet" ? "order-3" : "max-sm:order-3 sm:order-1";
  const oSrc = variant === "mobileSheet" ? "order-2" : "max-sm:order-2 sm:order-2";
  const oAmt = variant === "mobileSheet" ? "order-1" : "max-sm:order-1 sm:order-3";
  const oDate = variant === "mobileSheet" ? "order-4" : "max-sm:order-4 sm:order-4";
  const oTitle = variant === "mobileSheet" ? "order-5" : "max-sm:order-5 sm:order-5";
  const oNote = variant === "mobileSheet" ? "order-6" : "max-sm:order-6 sm:order-6";
  const oSubmit = variant === "mobileSheet" ? "order-7" : "max-sm:order-7 sm:order-7";

  return (
    <ServerActionForm action={createIncomeAction} className={layout} onSuccess={onSuccess}>
      <div className={oAcct}>
        <LabeledField label="Account" hint="Account that received this income.">
          <select id={`${fieldIds}-account`} name="accountId" className={selectClass}>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </LabeledField>
      </div>
      <div className={oSrc}>
        <LabeledField label="Source" hint="Income category (salary, interest, reimbursement, etc.).">
          <select id={`${fieldIds}-category`} name="categoryId" className={selectClass}>
            {incomeCategories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </LabeledField>
      </div>
      <div className={`${oAmt} ${spanFullSm}`}>
        <CurrencyAmountInput name="amount" label="Amount" placeholder="0.00" required />
      </div>
      <div className={`${oDate} ${spanFullSm}`}>
        <DateField name="date" label="Income date" hint="The date you assign to this income." defaultValue={today} required />
      </div>
      <LabeledField label="Title" hint="Optional (max 120 characters)." className={`${oTitle} ${spanFullSm}`}>
        <textarea
          name="title"
          rows={2}
          maxLength={120}
          className={textAreaClass}
          placeholder="e.g. Paycheque, freelance invoice"
          onBlur={applyRules}
        />
        <RuleAutofillHint outcome={rules.outcome} />
      </LabeledField>
      <LabeledField label="Note" hint="Optional (max 250 characters)." className={`${oNote} ${spanFullSm}`}>
        <textarea name="note" rows={4} maxLength={250} className={textAreaClass} placeholder="Additional details" />
      </LabeledField>
      <div className={`${oNote} ${spanFullSm}`}>
        <TagInput handleRef={tagInput} suggestions={tagOptions.names} />
      </div>
      <button type="submit" className={`${oSubmit} ${spanFullSm} ${primaryBtnClass} py-2.5 sm:py-2`}>
        Add income
      </button>
    </ServerActionForm>
  );
}

