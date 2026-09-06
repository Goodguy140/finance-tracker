"use client";

import { useId, type ChangeEvent, type ReactNode } from "react";
import { type ExpenseTitleSuggestion } from "@/lib/expense-title-suggestions";

export type Option = { id: string; name: string };

export type { ExpenseTitleSuggestion };

export function defaultExpenseAccountSelectValue(accounts: Option[], preferred?: string | null) {
  if (preferred && accounts.some((a) => a.id === preferred)) return preferred;
  return accounts[0]?.id ?? "";
}
export const inputClass =
  "w-full min-h-[2.75rem] rounded-xl border border-slate-700 bg-slate-950/70 px-3 py-2.5 text-base leading-normal text-slate-100 placeholder:text-slate-500 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-500/20 sm:text-sm";
export const selectClass =
  "w-full min-h-[2.75rem] rounded-xl border border-slate-700 bg-slate-950/70 px-3 py-2.5 text-base text-slate-100 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-500/20 sm:text-sm";
export const textAreaClass =
  "w-full min-h-[5rem] resize-y rounded-xl border border-slate-700 bg-slate-950/70 px-3 py-2.5 text-base leading-relaxed text-slate-100 placeholder:text-slate-500 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-500/20 sm:min-h-[4.5rem] sm:text-sm";
export const formGridResponsive =
  "grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-3";
export const spanFullSm =
  "w-full sm:col-span-2";
export const primaryBtnClass =
  "touch-manipulation inline-flex min-h-11 items-center justify-center rounded-xl bg-blue-500 px-3 py-3 text-sm font-medium text-white transition hover:bg-blue-400 sm:min-h-0 sm:py-2";
export const secondaryBtnClass =
  "touch-manipulation inline-flex min-h-11 items-center justify-center rounded-xl border border-slate-700 bg-slate-900 px-3 py-3 text-sm font-medium text-slate-200 transition hover:border-slate-600 hover:bg-slate-800 sm:min-h-0 sm:py-2";
export const floatingFieldLabelClass =
  "pointer-events-none absolute left-3 -top-2 z-10 rounded bg-slate-900 px-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400";

export function getTodayIsoDate() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function getProfileInitials(displayName: string, email: string) {
  const n = displayName.trim();
  if (n.length >= 1) {
    const parts = n.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
      const a = parts[0]?.[0];
      const b = parts[1]?.[0];
      if (a && b) return (a + b).toUpperCase();
    }
    return n.slice(0, 2).toUpperCase();
  }
  const local = email.split("@")[0] ?? email;
  return local.slice(0, 2).toUpperCase();
}
export function LabeledField({ label, hint, className, children }: { label: string; hint?: string; className?: string; children: ReactNode }) {
  return (
    <div className={`flex flex-col gap-1.5 ${className ?? ""}`}>
      <span className="text-sm font-medium text-slate-200">{label}</span>
      {hint ? <span className="text-xs leading-snug text-slate-500">{hint}</span> : null}
      {children}
    </div>
  );
}

export function CurrencyAmountInput({
  name,
  label,
  id,
  value,
  onChange,
  placeholder,
  className = "",
  defaultValue,
  required,
}: {
  name?: string;
  label?: string;
  id?: string;
  value?: string;
  onChange?: (event: ChangeEvent<HTMLInputElement>) => void;
  placeholder: string;
  className?: string;
  defaultValue?: string;
  required?: boolean;
}) {
  const autoId = useId();
  const fieldId = id ?? (name ? `amount-${name}-${autoId}` : `amount-${autoId}`);
  const isControlled = value !== undefined;
  const inner = (
    <div className="relative">
      <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-xs font-medium tracking-wide text-blue-300">
        CAD $
      </span>
      <input
        id={label ? fieldId : undefined}
        name={name}
        type="number"
        inputMode="decimal"
        step="0.01"
        placeholder={placeholder}
        className={`${inputClass} pl-16`}
        {...(isControlled ? { value, onChange } : { defaultValue })}
        {...(required ? { required: true } : {})}
      />
    </div>
  );
  if (label) {
    return (
      <div className={`flex flex-col gap-1.5 ${className}`}>
        <label htmlFor={fieldId} className="text-sm font-medium text-slate-200">
          {label}
        </label>
        {inner}
      </div>
    );
  }
  return <div className={`relative block ${className}`}>{inner}</div>;
}

export function DateField({
  name,
  label,
  hint,
  defaultValue,
  value,
  onChange,
  className = "",
  id,
  required,
}: {
  name: string;
  label: string;
  hint?: string;
  defaultValue?: string;
  /** Controlled value. When provided, the input is controlled and survives React's
      automatic form reset after a server action — useful for a "sticky" date. */
  value?: string;
  onChange?: (value: string) => void;
  className?: string;
  id?: string;
  required?: boolean;
}) {
  const autoId = useId();
  const fieldId = id ?? `date-${name}-${autoId}`;
  const controlled = value !== undefined;
  return (
    <div className={className}>
      <div className="flex flex-col gap-1.5">
        <label htmlFor={fieldId} className="text-sm font-medium text-slate-200">
          {label}
        </label>
        {hint ? <span className="text-xs leading-snug text-slate-500">{hint}</span> : null}
        <input
          id={fieldId}
          name={name}
          type="date"
          className={inputClass}
          autoComplete="off"
          {...(controlled
            ? { value, onChange: (e) => onChange?.(e.target.value) }
            : { defaultValue })}
          {...(required ? { required: true } : {})}
        />
      </div>
    </div>
  );
}

// CSV parsing lives in a pure module so it can be unit-tested; re-exported for existing imports.
export { parseCsvLine, parseCsvText } from "@/lib/csv";

export const importTargets = [
  { value: "", label: "Ignore this column" },
  { value: "amount", label: "Amount (required)" },
  { value: "date", label: "Transaction date" },
  { value: "postedDate", label: "Posted date" },
  { value: "title", label: "Transaction title" },
  { value: "accountName", label: "Account name" },
  { value: "categoryName", label: "Category name" },
  { value: "note", label: "Note" },
] as const;

type ImportTarget = (typeof importTargets)[number];

export function getCurrentPeriodMonth(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

export function getPreviousPeriodMonth(date = new Date()) {
  const year = date.getMonth() === 0 ? date.getFullYear() - 1 : date.getFullYear();
  const month = date.getMonth() === 0 ? 12 : date.getMonth();
  return `${year}-${String(month).padStart(2, "0")}`;
}

export function formatBudgetPeriodLabel(periodMonth: string) {
  const [y, m] = periodMonth.split("-").map((x) => Number.parseInt(x, 10));
  if (!Number.isFinite(y) || !Number.isFinite(m) || m < 1 || m > 12) return periodMonth;
  const d = new Date(y, m - 1, 1);
  return d.toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

export const noopSubscribe = () => () => {};

/** Cap when "All" is chosen so very large CSVs do not freeze the preview table. */
export const CSV_PREVIEW_ALL_MAX = 5000;

export function importTargetsForHeader(header: string, headers: string[], mapping: Record<string, string>): ImportTarget[] {
  const indexHere = headers.indexOf(header);
  const selectedHere = mapping[header] ?? "";
  return importTargets.filter((target) => {
    if (target.value === "") return true;
    if (target.value === selectedHere) return true;
    const claimedByEarlierColumn = headers.some(
      (h, idx) => idx < indexHere && (mapping[h] ?? "") === target.value,
    );
    return !claimedByEarlierColumn;
  });
}

