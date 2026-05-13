"use client";

import { useId, useLayoutEffect, useState, useSyncExternalStore, type ChangeEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { signIn, signOut } from "next-auth/react";
import { AccountTypePill } from "@/components/account-type-pill";
import { GoogleSignInForm } from "@/components/google-sign-in-form";
import { ServerActionForm } from "@/components/server-action-form";
import {
  changePasswordAction,
  clearUserFinancialDataAction,
  createExpenseAction,
  createFinancialAccountAction,
  importExpensesCsvAction,
  createIncomeAction,
  createInvestmentFlowAction,
  createPortfolioSnapshotAction,
  createSplitExpenseAction,
  createSubscriptionAction,
  deleteBudgetAction,
  deleteFinancialAccountAction,
  updateDefaultExpenseAccountAction,
  updateFinancialAccountAction,
  setFinancialAccountArchivedAction,
  deleteAccountAction,
  importUserBackupAction,
  requestPasswordResetAction,
  resetPasswordAction,
  signupAction,
  updateBudgetAction,
  updateAdminOauthSettingsAction,
  updateProfileAction,
  upsertBudgetAction,
} from "@/app/actions";
import { ACCOUNT_TYPE_LABELS, ACCOUNT_TYPE_ORDER } from "@/lib/account-type-labels";
import { parseImportedDate } from "@/lib/import-dates";
import { formatCurrency, parseStatementAmount } from "@/lib/money";

type Option = { id: string; name: string };

function defaultExpenseAccountSelectValue(accounts: Option[], preferred?: string | null) {
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
  "touch-manipulation rounded-xl bg-blue-500 px-3 py-2 text-sm font-medium text-white transition hover:bg-blue-400";
export const secondaryBtnClass =
  "touch-manipulation rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm font-medium text-slate-200 transition hover:border-slate-600 hover:bg-slate-800";
const floatingFieldLabelClass =
  "pointer-events-none absolute left-3 -top-2 z-10 rounded bg-slate-900 px-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400";

function getTodayIsoDate() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function getProfileInitials(displayName: string, email: string) {
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
  className = "",
  id,
  required,
}: {
  name: string;
  label: string;
  hint?: string;
  defaultValue?: string;
  className?: string;
  id?: string;
  required?: boolean;
}) {
  const autoId = useId();
  const fieldId = id ?? `date-${name}-${autoId}`;
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
          defaultValue={defaultValue}
          className={inputClass}
          {...(required ? { required: true } : {})}
        />
      </div>
    </div>
  );
}

function parseCsvLine(line: string) {
  const cells: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    const nextChar = line[i + 1];

    if (char === '"' && inQuotes && nextChar === '"') {
      current += '"';
      i += 1;
      continue;
    }
    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (char === "," && !inQuotes) {
      cells.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }

  cells.push(current.trim());
  return cells;
}

function parseCsvText(csvText: string) {
  const lines = csvText
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (lines.length < 2) return { headers: [] as string[], rows: [] as Record<string, string>[] };

  const headers = parseCsvLine(lines[0]);
  const rows = lines.slice(1).map((line) => {
    const cells = parseCsvLine(line);
    return headers.reduce<Record<string, string>>((acc, header, index) => {
      acc[header] = cells[index] ?? "";
      return acc;
    }, {});
  });

  return { headers, rows };
}

const importTargets = [
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

const noopSubscribe = () => () => {};

/** Cap when "All" is chosen so very large CSVs do not freeze the preview table. */
const CSV_PREVIEW_ALL_MAX = 5000;

function importTargetsForHeader(header: string, headers: string[], mapping: Record<string, string>): ImportTarget[] {
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

export function ExpenseCsvImportForm({
  accounts,
  expenseCategories,
  defaultExpenseAccountId,
}: {
  accounts: Option[];
  expenseCategories: Option[];
  defaultExpenseAccountId?: string | null;
}) {
  const hasHydrated = useSyncExternalStore(noopSubscribe, () => true, () => false);
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<Array<Record<string, string>>>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [defaultAccountId, setDefaultAccountId] = useState(() =>
    defaultExpenseAccountSelectValue(accounts, defaultExpenseAccountId),
  );
  const [defaultCategoryId, setDefaultCategoryId] = useState(expenseCategories[0]?.id ?? "");
  const [manualDate, setManualDate] = useState("");
  const [manualPostedDate, setManualPostedDate] = useState("");
  const [manualTitle, setManualTitle] = useState("");
  const [manualNote, setManualNote] = useState("");
  const [manualAccountName, setManualAccountName] = useState("");
  const [manualCategoryName, setManualCategoryName] = useState("");
  const [previewRowLimit, setPreviewRowLimit] = useState<string>("8");

  const selectedColumns = {
    amount: headers.find((header) => mapping[header] === "amount") ?? "",
    date: headers.find((header) => mapping[header] === "date") ?? "",
    postedDate: headers.find((header) => mapping[header] === "postedDate") ?? "",
    title: headers.find((header) => mapping[header] === "title") ?? "",
    accountName: headers.find((header) => mapping[header] === "accountName") ?? "",
    categoryName: headers.find((header) => mapping[header] === "categoryName") ?? "",
    note: headers.find((header) => mapping[header] === "note") ?? "",
  };
  const defaultAccountName = accounts.find((account) => account.id === defaultAccountId)?.name ?? "Default account";
  const defaultCategoryName =
    expenseCategories.find((category) => category.id === defaultCategoryId)?.name ?? "Default category";
  const effectivePreviewCount =
    previewRowLimit === "all"
      ? Math.min(rows.length, CSV_PREVIEW_ALL_MAX)
      : Math.min(Math.max(1, Number(previewRowLimit) || 8), rows.length);
  const previewRows = rows.slice(0, effectivePreviewCount).map((row, index) => {
    const amountRaw = selectedColumns.amount ? (row[selectedColumns.amount] ?? "").trim() : "";
    const amountParsed = amountRaw ? parseStatementAmount(amountRaw) : null;
    const dateRawFromCsv = selectedColumns.date ? (row[selectedColumns.date] ?? "").trim() : "";
    const dateRaw = dateRawFromCsv || manualDate;
    const dateValid = !dateRaw || parseImportedDate(dateRaw) !== null;
    const postedDateRawFromCsv = selectedColumns.postedDate
      ? (row[selectedColumns.postedDate] ?? "").trim()
      : "";
    const postedDateRawForParse = postedDateRawFromCsv || manualPostedDate;
    const postedDateValid = !postedDateRawForParse || parseImportedDate(postedDateRawForParse) !== null;
    const title = selectedColumns.title ? (row[selectedColumns.title] ?? "").trim() || manualTitle || "-" : manualTitle || "-";
    const note = selectedColumns.note ? (row[selectedColumns.note] ?? "").trim() || manualNote || "-" : manualNote || "-";
    const postedDate = selectedColumns.postedDate
      ? (row[selectedColumns.postedDate] ?? "").trim() || manualPostedDate || "-"
      : manualPostedDate || "-";
    const account = selectedColumns.accountName
      ? (row[selectedColumns.accountName] ?? "").trim() || manualAccountName || defaultAccountName
      : manualAccountName || defaultAccountName;
    const category = selectedColumns.categoryName
      ? (row[selectedColumns.categoryName] ?? "").trim() || manualCategoryName || defaultCategoryName
      : manualCategoryName || defaultCategoryName;
    const hasAmount = amountRaw.length > 0;
    const validAmount = hasAmount && amountParsed !== null;
    let status = "Ready";
    if (!hasAmount) status = "Skipped: missing amount";
    else if (!validAmount) status = "Skipped: invalid amount";
    else if (!dateValid) status = "Skipped: invalid date";
    else if (!postedDateValid) status = "Skipped: invalid posted date";

    return {
      key: `preview-row-${index}`,
      amount: hasAmount && amountParsed !== null ? amountParsed.toFixed(2) : amountRaw || "-",
      date: dateRaw || "Today",
      postedDate,
      account,
      category,
      title,
      note,
      status,
    };
  });
  const previewValidCount = previewRows.filter((row) => row.status === "Ready").length;
  const previewSkippedCount = previewRows.length - previewValidCount;

  return (
    <ServerActionForm action={importExpensesCsvAction} className="space-y-3 rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
      <div>
        <h3 className="font-semibold text-slate-100">Import Expenses from CSV</h3>
        <p className="text-xs text-slate-400">
          Upload any CSV, map each column to a field, and import expenses. Credits (refunds, reversals) may appear as
          negative amounts or parentheses, e.g. <code className="text-slate-300">-12.34</code> or{" "}
          <code className="text-slate-300">(12.34)</code> — they use the same columns and reduce category spend in
          budgets.
        </p>
      </div>

      <input
        type="file"
        accept=".csv,text/csv"
        className={inputClass}
        onChange={async (event) => {
          const file = event.target.files?.[0];
          if (!file) return;
          const text = await file.text();
          const parsed = parseCsvText(text);
          if (parsed.headers.length === 0 || parsed.rows.length === 0) {
            setError("CSV needs a header row and at least one data row.");
            setHeaders([]);
            setRows([]);
            setMapping({});
            setPreviewRowLimit("8");
            return;
          }
          setError("");
          setPreviewRowLimit("8");
          setHeaders(parsed.headers);
          setRows(parsed.rows);

          const autoMapping: Record<string, string> = {};
          const usedFields = new Set<string>();
          for (const header of parsed.headers) {
            const normalized = header.toLowerCase().replace(/[\s_-]/g, "");
            let field = "";
            if (normalized.includes("amount")) field = "amount";
            else if (normalized.includes("posted")) field = "postedDate";
            else if (normalized === "date" || normalized.includes("transactiondate")) field = "date";
            else if (normalized.includes("category")) field = "categoryName";
            else if (normalized.includes("account")) field = "accountName";
            else if (normalized.includes("memo") || normalized.includes("note")) field = "note";
            else if (normalized.includes("title") || normalized.includes("description")) field = "title";
            if (field && usedFields.has(field)) field = "";
            else if (field) usedFields.add(field);
            autoMapping[header] = field;
          }
          setMapping(autoMapping);
        }}
      />

      {error ? <p className="text-sm text-red-300">{error}</p> : null}

      {headers.length > 0 ? (
        <>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <label className="block">
              <span className={floatingFieldLabelClass}>Default account</span>
              <select
                name="defaultAccountId"
                className={`${selectClass} pt-3`}
                value={defaultAccountId}
                onChange={(event) => setDefaultAccountId(event.target.value)}
              >
                {accounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className={floatingFieldLabelClass}>Default category</span>
              <select
                name="defaultCategoryId"
                className={`${selectClass} pt-3`}
                value={defaultCategoryId}
                onChange={(event) => setDefaultCategoryId(event.target.value)}
              >
                {expenseCategories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <label className="block">
              <span className={floatingFieldLabelClass}>Manual transaction date</span>
              <input
                type="date"
                className={`${inputClass} pt-3`}
                value={manualDate}
                onChange={(event) => setManualDate(event.target.value)}
              />
            </label>
            <label className="block">
              <span className={floatingFieldLabelClass}>Manual posted date</span>
              <input
                type="date"
                className={`${inputClass} pt-3`}
                value={manualPostedDate}
                onChange={(event) => setManualPostedDate(event.target.value)}
              />
            </label>
            <input
              className={inputClass}
              placeholder="Manual title (fallback)"
              value={manualTitle}
              onChange={(event) => setManualTitle(event.target.value)}
            />
            <input
              className={inputClass}
              placeholder="Manual note (fallback)"
              value={manualNote}
              onChange={(event) => setManualNote(event.target.value)}
            />
            <input
              className={inputClass}
              placeholder="Manual account name (fallback)"
              value={manualAccountName}
              onChange={(event) => setManualAccountName(event.target.value)}
            />
            <input
              className={inputClass}
              placeholder="Manual category name (fallback)"
              value={manualCategoryName}
              onChange={(event) => setManualCategoryName(event.target.value)}
            />
          </div>

          <div className="space-y-2">
            {headers.map((header) => (
              <label key={header} className="grid grid-cols-1 items-center gap-2 rounded-xl border border-slate-800 bg-slate-950/50 p-2 sm:grid-cols-[1fr_13rem]">
                <span className="text-sm text-slate-200">{header}</span>
                <select
                  className={selectClass}
                  value={mapping[header] ?? ""}
                  onChange={(event) =>
                    setMapping((prev) => ({
                      ...prev,
                      [header]: event.target.value,
                    }))
                  }
                >
                  {importTargetsForHeader(header, headers, mapping).map((target) => (
                    <option key={target.value || "ignore"} value={target.value}>
                      {target.label}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>

          <input type="hidden" name="rowsJson" value={JSON.stringify(rows)} />
          <input type="hidden" name="fieldSelections" value={JSON.stringify(headers.map((header) => mapping[header] ?? ""))} />
          <input type="hidden" name="map_amount" value={selectedColumns.amount} />
          <input type="hidden" name="map_date" value={selectedColumns.date} />
          <input type="hidden" name="map_postedDate" value={selectedColumns.postedDate} />
          <input type="hidden" name="map_title" value={selectedColumns.title} />
          <input type="hidden" name="map_note" value={selectedColumns.note} />
          <input type="hidden" name="map_accountName" value={selectedColumns.accountName} />
          <input type="hidden" name="map_categoryName" value={selectedColumns.categoryName} />
          <input type="hidden" name="manual_date" value={manualDate} />
          <input type="hidden" name="manual_postedDate" value={manualPostedDate} />
          <input type="hidden" name="manual_title" value={manualTitle} />
          <input type="hidden" name="manual_note" value={manualNote} />
          <input type="hidden" name="manual_accountName" value={manualAccountName} />
          <input type="hidden" name="manual_categoryName" value={manualCategoryName} />

          <div className="flex flex-col gap-2 rounded-xl border border-slate-800 bg-slate-950/50 p-2 text-xs text-slate-400 sm:flex-row sm:items-center sm:justify-between">
            <p>
              Previewing {previewRows.length} of {rows.length} rows. Ready: {previewValidCount} | Skipped:{" "}
              {previewSkippedCount}
              {previewRowLimit === "all" && rows.length > CSV_PREVIEW_ALL_MAX ? (
                <span className="block text-amber-300/90 sm:mt-0 sm:inline sm:pl-1">
                  (first {CSV_PREVIEW_ALL_MAX} only — choose a number to cap differently)
                </span>
              ) : null}
            </p>
            <label className="flex shrink-0 items-center gap-2 text-slate-300">
              <span className="whitespace-nowrap">Preview rows</span>
              <select
                className={`${selectClass} min-w-[7.5rem] py-1.5 text-xs`}
                value={previewRowLimit}
                onChange={(event) => setPreviewRowLimit(event.target.value)}
              >
                <option value="8">8</option>
                <option value="25">25</option>
                <option value="50">50</option>
                <option value="100">100</option>
                <option value="250">250</option>
                <option value="500">500</option>
                <option value="all">All (max {CSV_PREVIEW_ALL_MAX})</option>
              </select>
            </label>
          </div>

          <div className="max-h-[min(70vh,32rem)] overflow-x-auto overflow-y-auto rounded-xl border border-slate-800 bg-slate-950/60">
            <table className="min-w-full text-left text-xs text-slate-300">
              <thead className="bg-slate-900/80 text-slate-200">
                <tr>
                  <th className="px-2 py-1.5">Amount</th>
                  <th className="px-2 py-1.5">Transaction Date</th>
                  <th className="px-2 py-1.5">Posted Date</th>
                  <th className="px-2 py-1.5">Title</th>
                  <th className="px-2 py-1.5">Account</th>
                  <th className="px-2 py-1.5">Category</th>
                  <th className="px-2 py-1.5">Note</th>
                  <th className="px-2 py-1.5">Status</th>
                </tr>
              </thead>
              <tbody>
                {previewRows.map((row) => (
                  <tr key={row.key} className="border-t border-slate-800">
                    <td className="px-2 py-1.5">{row.amount}</td>
                    <td className="px-2 py-1.5">{row.date}</td>
                    <td className="px-2 py-1.5">{row.postedDate}</td>
                    <td className="px-2 py-1.5">{row.title}</td>
                    <td className="px-2 py-1.5">{row.account}</td>
                    <td className="px-2 py-1.5">{row.category}</td>
                    <td className="px-2 py-1.5">{row.note}</td>
                    <td className={`px-2 py-1.5 ${row.status === "Ready" ? "text-emerald-300" : "text-amber-300"}`}>
                      {row.status}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}

      <button
        className={primaryBtnClass}
        disabled={!hasHydrated || headers.length === 0}
        type="submit"
      >
        Import CSV
      </button>
    </ServerActionForm>
  );
}

export function SignupForm() {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  return (
    <form
      className="space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        setError(null);
        setPending(true);
        const form = e.currentTarget;
        const formData = new FormData(form);
        try {
          await signupAction(formData);
          const email = String(formData.get("email") ?? "");
          const password = String(formData.get("password") ?? "");
          await signIn("credentials", {
            email,
            password,
            callbackUrl: `${window.location.origin}/`,
          });
        } catch (err) {
          setError(err instanceof Error ? err.message : "Sign up failed.");
        } finally {
          setPending(false);
        }
      }}
    >
      {error ? <p className="text-sm text-red-300">{error}</p> : null}
      <input
        name="displayName"
        required
        placeholder="Display name"
        className={inputClass}
      />
      <input
        name="email"
        required
        type="email"
        placeholder="Email"
        className={inputClass}
      />
      <input
        name="password"
        required
        type="password"
        placeholder="Password (min 8)"
        className={inputClass}
      />
      <input
        name="countryCode"
        defaultValue="CA"
        className={inputClass}
      />
      <input
        name="timezone"
        defaultValue="America/Toronto"
        className={inputClass}
      />
      <button className={primaryBtnClass} disabled={pending} type="submit">
        Create account
      </button>
    </form>
  );
}

export function LoginForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  return (
    <div className="space-y-3">
      <form
        className="space-y-3"
        onSubmit={async (e) => {
          e.preventDefault();
          setError(null);
          setPending(true);
          try {
            const origin = typeof window !== "undefined" ? window.location.origin : "";
            const result = await signIn("credentials", {
              email,
              password,
              callbackUrl: `${origin}/`,
              redirect: false,
            });
            if (result?.error) {
              setError("Invalid email or password.");
              return;
            }
            if (result?.url) {
              window.location.href = result.url;
              return;
            }
            window.location.href = `${origin}/`;
          } catch {
            setError("Sign-in failed. Please try again.");
          } finally {
            setPending(false);
          }
        }}
      >
        {error ? <p className="text-sm text-red-300">{error}</p> : null}
        <input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          type="email"
          placeholder="Email"
          className={inputClass}
        />
        <input
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          type="password"
          placeholder="Password"
          className={inputClass}
        />
        <button type="submit" disabled={pending} className={`w-full ${primaryBtnClass} py-2.5 sm:py-2`}>
          Login
        </button>
      </form>
      <GoogleSignInForm callbackUrl="/" />
    </div>
  );
}

export function LogoutButton() {
  return (
    <button onClick={() => signOut({ callbackUrl: "/login" })} className={secondaryBtnClass}>
      Logout
    </button>
  );
}

type AddMenuFormKey = "income" | "splitExpense" | "subscription" | "investment";

export function AddFormsDropdown({
  accounts,
  expenseCategories,
  incomeCategories,
  defaultExpenseAccountId,
}: {
  accounts: Option[];
  expenseCategories: Option[];
  incomeCategories: Option[];
  defaultExpenseAccountId?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [activeForm, setActiveForm] = useState<AddMenuFormKey>("income");

  return (
    <div className="relative z-50">
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
        className="touch-manipulation rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200 transition hover:border-slate-600 hover:bg-slate-800 sm:py-1.5"
      >
        Add
      </button>
      {open && typeof document !== "undefined"
        ? createPortal(
            <>
              <button
                type="button"
                className="fixed inset-0 z-[55] bg-black/50 sm:hidden"
                aria-label="Close add menu"
                onClick={() => setOpen(false)}
              />
              <div
                role="dialog"
                aria-modal="true"
                aria-labelledby="add-menu-title"
                className="fixed z-[60] overflow-y-auto overscroll-contain border border-slate-700 bg-slate-950/98 shadow-2xl backdrop-blur max-sm:inset-x-0 max-sm:bottom-0 max-sm:left-0 max-sm:right-0 max-sm:max-h-[min(calc(100dvh-env(safe-area-inset-top,0px)-12px),42rem)] max-sm:rounded-t-2xl max-sm:p-4 max-sm:pb-[max(1rem,env(safe-area-inset-bottom))] sm:inset-auto sm:right-3 sm:top-[4.75rem] sm:mt-0 sm:max-h-[min(85vh,40rem)] sm:w-[min(92vw,32rem)] sm:rounded-2xl sm:p-4 sm:pb-4 md:right-4 md:top-24"
              >
          <h2 id="add-menu-title" className="sr-only">
            Add transaction
          </h2>
          <div className="mb-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setActiveForm("income")}
              className={`rounded-lg px-2.5 py-1.5 text-xs font-medium transition ${
                activeForm === "income" ? "bg-blue-500 text-white" : "bg-slate-800 text-slate-300 hover:bg-slate-700"
              }`}
            >
              Income
            </button>
            <button
              type="button"
              onClick={() => setActiveForm("splitExpense")}
              className={`rounded-lg px-2.5 py-1.5 text-xs font-medium transition ${
                activeForm === "splitExpense" ? "bg-blue-500 text-white" : "bg-slate-800 text-slate-300 hover:bg-slate-700"
              }`}
            >
              Split Expense
            </button>
            <button
              type="button"
              onClick={() => setActiveForm("subscription")}
              className={`rounded-lg px-2.5 py-1.5 text-xs font-medium transition ${
                activeForm === "subscription" ? "bg-blue-500 text-white" : "bg-slate-800 text-slate-300 hover:bg-slate-700"
              }`}
            >
              Subscription
            </button>
            <button
              type="button"
              onClick={() => setActiveForm("investment")}
              className={`rounded-lg px-2.5 py-1.5 text-xs font-medium transition ${
                activeForm === "investment" ? "bg-blue-500 text-white" : "bg-slate-800 text-slate-300 hover:bg-slate-700"
              }`}
            >
              Investments
            </button>
          </div>

          {activeForm === "income" ? (
            <IncomeForm accounts={accounts} incomeCategories={incomeCategories} />
          ) : null}
          {activeForm === "splitExpense" ? (
            <SplitExpenseForm
              accounts={accounts}
              expenseCategories={expenseCategories}
              defaultExpenseAccountId={defaultExpenseAccountId}
            />
          ) : null}
          {activeForm === "subscription" ? (
            <SubscriptionForm
              accounts={accounts}
              expenseCategories={expenseCategories}
              defaultExpenseAccountId={defaultExpenseAccountId}
            />
          ) : null}
          {activeForm === "investment" ? <InvestmentForms accounts={accounts} /> : null}

              <div className="mt-4 flex justify-end sm:mt-3">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2.5 text-sm font-medium text-slate-300 transition hover:bg-slate-800 sm:w-auto sm:rounded-lg sm:px-2.5 sm:py-1.5 sm:text-xs touch-manipulation"
                >
                  Close
                </button>
              </div>
            </div>
            </>,
            document.body,
          )
        : null}
    </div>
  );
}

export function ExpenseForm({
  accounts,
  expenseCategories,
  defaultExpenseAccountId,
}: {
  accounts: Option[];
  expenseCategories: Option[];
  defaultExpenseAccountId?: string | null;
}) {
  const today = getTodayIsoDate();
  const fieldIds = useId();
  const accountSelectDefault = defaultExpenseAccountSelectValue(accounts, defaultExpenseAccountId);
  const [receiptBreakdown, setReceiptBreakdown] = useState(false);
  const [showPostedDate, setShowPostedDate] = useState(false);
  const [showTitle, setShowTitle] = useState(true);
  const [showNote, setShowNote] = useState(false);
  const [amountValue, setAmountValue] = useState("");
  const [preCreditValue, setPreCreditValue] = useState("");
  const [creditRows, setCreditRows] = useState<string[]>([""]);
  const creditSum = sumCredits(creditRows);
  const preCreditNumber = Number(preCreditValue);
  const hasValidPreCredit = Number.isFinite(preCreditNumber);
  const netPaidPreview = hasValidPreCredit ? preCreditNumber - creditSum : null;

  function sumCredits(rows: string[]) {
    return rows.reduce((sum, row) => {
      const n = Number(row);
      return Number.isFinite(n) && n >= 0 ? sum + n : sum;
    }, 0);
  }

  function toggleReceiptBreakdown() {
    if (!receiptBreakdown) {
      if (preCreditValue.trim() === "" && amountValue.trim() !== "") {
        setPreCreditValue(amountValue);
      }
      setReceiptBreakdown(true);
      return;
    }

    const pre = Number(preCreditValue);
    if (Number.isFinite(pre) && pre > 0) {
      const net = pre - sumCredits(creditRows);
      if (Number.isFinite(net) && net !== 0) {
        setAmountValue(String(Number(net.toFixed(2))));
      } else {
        setAmountValue(String(Number(pre.toFixed(2))));
      }
    }
    setReceiptBreakdown(false);
  }

  return (
    <ServerActionForm action={createExpenseAction} className={formGridResponsive}>
      {showTitle ? (
        <LabeledField
          label="Title"
          hint="Optional. Shown in your expense log (max 120 characters)."
          className={spanFullSm}
        >
          <textarea
            name="title"
            rows={2}
            maxLength={120}
            className={textAreaClass}
            placeholder="e.g. Weekly groceries, Shell fuel"
          />
        </LabeledField>
      ) : (
        <input type="hidden" name="title" value="" />
      )}
      <LabeledField label="Account" hint="Financial account this expense is charged to.">
        <select
          id={`${fieldIds}-account`}
          name="accountId"
          className={selectClass}
          defaultValue={accountSelectDefault}
        >
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </LabeledField>
      <LabeledField label="Category" hint="Expense category for budgeting and reports.">
        <select id={`${fieldIds}-category`} name="categoryId" className={selectClass}>
          {expenseCategories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </LabeledField>

      <div className={`${spanFullSm} flex flex-wrap gap-2`}>
        <button
          type="button"
          onClick={() => setShowPostedDate((v) => !v)}
          className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${
            showPostedDate
              ? "border-blue-500/40 bg-blue-500/15 text-blue-100"
              : "border-slate-700/80 bg-slate-950/50 text-slate-300 hover:bg-slate-900/70"
          }`}
        >
          Posted date
        </button>
        <button
          type="button"
          onClick={() => setShowTitle((v) => !v)}
          className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${
            showTitle
              ? "border-blue-500/40 bg-blue-500/15 text-blue-100"
              : "border-slate-700/80 bg-slate-950/50 text-slate-300 hover:bg-slate-900/70"
          }`}
        >
          Title
        </button>
        <button
          type="button"
          onClick={() => setShowNote((v) => !v)}
          className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${
            showNote
              ? "border-blue-500/40 bg-blue-500/15 text-blue-100"
              : "border-slate-700/80 bg-slate-950/50 text-slate-300 hover:bg-slate-900/70"
          }`}
        >
          Note
        </button>
        <button
          type="button"
          onClick={toggleReceiptBreakdown}
          className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${
            receiptBreakdown
              ? "border-emerald-500/45 bg-emerald-500/15 text-emerald-100"
              : "border-slate-700/80 bg-slate-950/50 text-slate-300 hover:bg-slate-900/70"
          }`}
        >
          Receipt breakdown
        </button>
      </div>

      {!receiptBreakdown ? (
        <>
          <LabeledField label="Amount" hint="Tip: use a negative amount for full refunds or chargebacks.">
            <CurrencyAmountInput
              name="amount"
              placeholder="0.00 (negative for credits)"
              value={amountValue}
              onChange={(e) => setAmountValue(e.target.value)}
              required
            />
          </LabeledField>
          <input type="hidden" name="preCreditTotal" value="" />
          <input type="hidden" name="creditTotal" value="" />
        </>
      ) : (
        <div
          className={`${spanFullSm} space-y-4 rounded-xl border border-emerald-500/20 bg-gradient-to-br from-slate-950/80 to-slate-900/40 p-4 ring-1 ring-emerald-500/10 sm:p-5`}
        >
          <div className="space-y-1">
            <p className="text-sm font-medium text-slate-100">Totals from your receipt</p>
            <p className="text-xs leading-relaxed text-slate-500">
              Budgets and reports use the amount you actually paid (total minus credits). Points or cashback can go in
              credits.
            </p>
          </div>
          <div className={`${formGridResponsive} gap-4`}>
            <CurrencyAmountInput
              name="preCreditTotal"
              label="Total before credits"
              placeholder="0.00"
              value={preCreditValue}
              onChange={(e) => setPreCreditValue(e.target.value)}
              required
            />
            <div className="space-y-2">
              <p className="text-sm font-medium text-slate-200">Credits & discounts</p>
              <div className="space-y-2">
                {creditRows.map((value, idx) => (
                  <div key={idx} className="flex items-center gap-2">
                    <CurrencyAmountInput
                      name="creditTotal"
                      label={undefined}
                      placeholder={idx === 0 ? "0.00" : `Credit #${idx + 1}`}
                      value={value}
                      onChange={(e) =>
                        setCreditRows((rows) => rows.map((r, i) => (i === idx ? e.target.value : r)))
                      }
                    />
                    {creditRows.length > 1 ? (
                      <button
                        type="button"
                        onClick={() =>
                          setCreditRows((rows) => rows.filter((_, i) => i !== idx))
                        }
                        className="shrink-0 rounded-lg border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-300 hover:bg-slate-800"
                        aria-label={`Remove credit ${idx + 1}`}
                      >
                        Remove
                      </button>
                    ) : null}
                  </div>
                ))}
              </div>
              <button
                type="button"
                onClick={() => setCreditRows((rows) => [...rows, ""])}
                className="rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs font-medium text-slate-200 transition hover:bg-slate-800"
              >
                Add another credit
              </button>
              <div className="rounded-lg border border-slate-800/80 bg-slate-950/60 px-3 py-2 text-xs text-slate-300">
                <p className="tabular-nums">
                  Credit sum: <span className="font-medium text-emerald-300">{creditSum.toFixed(2)}</span>
                </p>
                <p className="mt-1 tabular-nums text-slate-400">
                  Net paid preview:{" "}
                  <span className="font-medium text-slate-200">
                    {netPaidPreview !== null ? netPaidPreview.toFixed(2) : "--"}
                  </span>
                </p>
              </div>
            </div>
          </div>
          <p className="border-t border-slate-800/90 pt-3 text-xs leading-relaxed text-slate-500">
            Enter the full receipt total first, then add each reward, coupon, or statement credit separately. We
            automatically sum all credits and save your paid amount as <span className="font-medium text-slate-300">total minus combined credits</span>.
          </p>
          <input type="hidden" name="amount" value="" />
        </div>
      )}

      <DateField
        name="date"
        label="Transaction date"
        hint="The date you assign to this purchase or charge."
        defaultValue={today}
      />
      {showPostedDate ? (
        <DateField
          name="postedDate"
          label="Posted date"
          hint="Optional. When the transaction cleared on your statement, if different from the transaction date."
          className={spanFullSm}
        />
      ) : (
        <input type="hidden" name="postedDate" value="" />
      )}
      {showNote ? (
        <LabeledField label="Note" hint="Optional details (max 250 characters)." className={spanFullSm}>
          <textarea name="note" rows={4} maxLength={250} className={textAreaClass} placeholder="Extra context, memo, or split notes" />
        </LabeledField>
      ) : (
        <input type="hidden" name="note" value="" />
      )}
      <button type="submit" className={`${spanFullSm} ${primaryBtnClass} py-2.5 sm:py-2`}>
        Add expense
      </button>
    </ServerActionForm>
  );
}

export function IncomeForm({ accounts, incomeCategories }: { accounts: Option[]; incomeCategories: Option[] }) {
  const today = getTodayIsoDate();
  const fieldIds = useId();

  return (
    <ServerActionForm action={createIncomeAction} className={formGridResponsive}>
      <LabeledField label="Account" hint="Account that received this income.">
        <select id={`${fieldIds}-account`} name="accountId" className={selectClass}>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </LabeledField>
      <LabeledField label="Source" hint="Income category (salary, interest, reimbursement, etc.).">
        <select id={`${fieldIds}-category`} name="categoryId" className={selectClass}>
          {incomeCategories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </LabeledField>
      <CurrencyAmountInput name="amount" label="Amount" placeholder="0.00" />
      <DateField name="date" label="Income date" hint="The date you assign to this income." defaultValue={today} />
      <LabeledField label="Title" hint="Optional (max 120 characters)." className={spanFullSm}>
        <textarea
          name="title"
          rows={2}
          maxLength={120}
          className={textAreaClass}
          placeholder="e.g. Paycheque, freelance invoice"
        />
      </LabeledField>
      <LabeledField label="Note" hint="Optional (max 250 characters)." className={spanFullSm}>
        <textarea name="note" rows={4} maxLength={250} className={textAreaClass} placeholder="Additional details" />
      </LabeledField>
      <button type="submit" className={`${spanFullSm} ${primaryBtnClass} py-2.5 sm:py-2`}>
        Add income
      </button>
    </ServerActionForm>
  );
}

export function SplitExpenseForm({
  accounts,
  expenseCategories,
  defaultExpenseAccountId,
}: {
  accounts: Option[];
  expenseCategories: Option[];
  defaultExpenseAccountId?: string | null;
}) {
  const defaultCategoryId = expenseCategories[0]?.id ?? "";
  const today = getTodayIsoDate();
  const fieldIds = useId();
  const accountSelectDefault = defaultExpenseAccountSelectValue(accounts, defaultExpenseAccountId);
  const [parts, setParts] = useState<Array<{ categoryId: string; amount: string }>>([
    { categoryId: defaultCategoryId, amount: "0" },
  ]);
  const serializedParts = JSON.stringify(
    parts.map((part) => ({
      categoryId: part.categoryId,
      amount: Number(part.amount || 0),
    })),
  );

  return (
    <ServerActionForm action={createSplitExpenseAction} className={formGridResponsive}>
      <LabeledField label="Account" hint="Account for this split expense.">
        <select
          id={`${fieldIds}-account`}
          name="accountId"
          className={selectClass}
          defaultValue={accountSelectDefault}
        >
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </LabeledField>
      <DateField
        name="date"
        label="Transaction date"
        hint="Date shown for the combined split transaction."
        defaultValue={today}
      />
      {parts.map((part, index) => (
        <div
          key={`split-part-${index}`}
          className={`${spanFullSm} grid grid-cols-1 gap-3 border-t border-slate-800 pt-3 sm:grid-cols-5 sm:gap-2 sm:border-0 sm:pt-0`}
        >
          <LabeledField label="Category for this portion" className="sm:col-span-3">
            <select
              id={`${fieldIds}-split-cat-${index}`}
              value={part.categoryId}
              onChange={(e) =>
                setParts((prev) =>
                  prev.map((entry, entryIndex) =>
                    entryIndex === index ? { ...entry, categoryId: e.target.value } : entry,
                  ),
                )
              }
              className={selectClass}
            >
              {expenseCategories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </LabeledField>
          <CurrencyAmountInput
            label="Part amount"
            value={part.amount}
            onChange={(e) =>
              setParts((prev) =>
                prev.map((entry, entryIndex) =>
                  entryIndex === index ? { ...entry, amount: e.target.value } : entry,
                ),
              )
            }
            placeholder="0.00"
            className="sm:col-span-2"
          />
          {parts.length > 1 ? (
            <button
              type="button"
              onClick={() => setParts((prev) => prev.filter((_, partIndex) => partIndex !== index))}
              className={`sm:col-span-5 ${secondaryBtnClass} py-2.5 sm:py-2`}
            >
              Remove this portion
            </button>
          ) : null}
        </div>
      ))}
      <div className={`${spanFullSm} flex flex-col gap-2 sm:flex-row sm:items-center`}>
        <button
          type="button"
          onClick={() => setParts((prev) => [...prev, { categoryId: defaultCategoryId, amount: "0" }])}
          className={`${secondaryBtnClass} py-2.5 sm:py-2`}
        >
          Add another portion
        </button>
      </div>
      <input type="hidden" name="parts" value={serializedParts} />
      <LabeledField label="Title" hint="Optional (max 120 characters)." className={spanFullSm}>
        <textarea
          name="title"
          rows={2}
          maxLength={120}
          className={textAreaClass}
          placeholder="Overall split title"
        />
      </LabeledField>
      <LabeledField label="Note" hint="Optional (max 250 characters)." className={spanFullSm}>
        <textarea name="note" rows={4} maxLength={250} className={textAreaClass} placeholder="Notes for this split" />
      </LabeledField>
      <button type="submit" className={`${spanFullSm} ${primaryBtnClass} py-2.5 sm:py-2`}>
        Add split expense
      </button>
    </ServerActionForm>
  );
}

function getCurrentPeriodMonth(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function getPreviousPeriodMonth(date = new Date()) {
  const year = date.getMonth() === 0 ? date.getFullYear() - 1 : date.getFullYear();
  const month = date.getMonth() === 0 ? 12 : date.getMonth();
  return `${year}-${String(month).padStart(2, "0")}`;
}

function formatBudgetPeriodLabel(periodMonth: string) {
  const [y, m] = periodMonth.split("-").map((x) => Number.parseInt(x, 10));
  if (!Number.isFinite(y) || !Number.isFinite(m) || m < 1 || m > 12) return periodMonth;
  const d = new Date(y, m - 1, 1);
  return d.toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

export function BudgetForm({ expenseCategories }: { expenseCategories: Option[] }) {
  const [isPastOverride, setIsPastOverride] = useState(false);
  const previousPeriodMonth = getPreviousPeriodMonth();
  const categorySuggestionsId = useId();
  const rollingMonthLabel = formatBudgetPeriodLabel(getCurrentPeriodMonth());

  return (
    <ServerActionForm action={upsertBudgetAction} className={`${formGridResponsive} gap-4`}>
      <LabeledField
        label="Expense category"
        hint="Match an existing category or type a new name to create one for this budget."
        className={spanFullSm}
      >
        <input
          name="categoryName"
          list={categorySuggestionsId}
          placeholder="e.g. Groceries, Transit"
          className={inputClass}
          autoComplete="off"
          required
        />
        <datalist id={categorySuggestionsId}>
          {expenseCategories.map((category) => (
            <option key={category.id} value={category.name} />
          ))}
        </datalist>
      </LabeledField>

      <div className={`${spanFullSm} rounded-xl border border-slate-700/90 bg-slate-950/45 p-4`}>
        <label className="flex cursor-pointer items-start gap-3">
          <input
            type="checkbox"
            checked={isPastOverride}
            onChange={(e) => setIsPastOverride(e.target.checked)}
            className="mt-1 h-4 w-4 shrink-0 rounded border-slate-600 bg-slate-900 text-blue-500 focus:ring-2 focus:ring-blue-500/30"
          />
          <span className="min-w-0 space-y-1">
            <span className="block text-sm font-medium text-slate-200">Past-month override</span>
            <span className="block text-xs leading-relaxed text-slate-500">
              Turn on to set a limit for a single historical month. Leave off for a rolling budget that continues from
              the current month forward.
            </span>
          </span>
        </label>
        {isPastOverride ? (
          <div className="mt-4 space-y-2">
            <span className="text-xs font-medium text-slate-400">Calendar month</span>
            <input
              type="month"
              name="periodMonth"
              max={previousPeriodMonth}
              defaultValue={previousPeriodMonth}
              className={inputClass}
            />
          </div>
        ) : (
          <input type="hidden" name="periodMonth" value="" />
        )}
        <p className="mt-3 text-xs leading-relaxed text-slate-500">
          {isPastOverride
            ? "Applies only to the month you pick above. Useful for backfilling or correcting an older period."
            : `Rolling budget starts at ${rollingMonthLabel} and carries forward into future months unless you replace it.`}
        </p>
      </div>

      <CurrencyAmountInput
        name="limit"
        label="Monthly limit"
        placeholder="0.00"
        className={spanFullSm}
        required
      />

      <div className={spanFullSm}>
        <button type="submit" className={`w-full sm:w-auto ${primaryBtnClass} px-5 py-2.5`}>
          Save budget
        </button>
      </div>
    </ServerActionForm>
  );
}

export function SubscriptionForm({
  accounts,
  expenseCategories,
  defaultExpenseAccountId,
}: {
  accounts: Option[];
  expenseCategories: Option[];
  defaultExpenseAccountId?: string | null;
}) {
  const today = getTodayIsoDate();
  const fieldIds = useId();
  const accountSelectDefault = defaultExpenseAccountSelectValue(accounts, defaultExpenseAccountId);

  return (
    <ServerActionForm action={createSubscriptionAction} className={formGridResponsive}>
      <LabeledField label="Subscription name" hint="Shown in your subscription list." className={spanFullSm}>
        <textarea
          name="name"
          rows={2}
          maxLength={80}
          className={textAreaClass}
          placeholder="e.g. Netflix, gym membership"
        />
      </LabeledField>
      <LabeledField label="Account" hint="Account charged for this subscription.">
        <select
          id={`${fieldIds}-account`}
          name="accountId"
          className={selectClass}
          defaultValue={accountSelectDefault}
        >
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </LabeledField>
      <LabeledField label="Category" hint="Expense category for budgeting.">
        <select id={`${fieldIds}-category`} name="categoryId" className={selectClass}>
          {expenseCategories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </LabeledField>
      <CurrencyAmountInput name="amount" label="Amount per charge" placeholder="0.00" />
      <LabeledField label="Billing cycle" hint="How often you are charged.">
        <select id={`${fieldIds}-cycle`} name="billingCycle" className={selectClass}>
          <option value="WEEKLY">Weekly</option>
          <option value="MONTHLY">Monthly</option>
          <option value="QUARTERLY">Quarterly</option>
          <option value="YEARLY">Yearly</option>
          <option value="BIENNIAL">Every 2 years</option>
        </select>
      </LabeledField>
      <DateField
        name="nextChargeDate"
        label="Next charge date"
        hint="The next date you expect this charge to post."
        defaultValue={today}
        className={spanFullSm}
      />
      <button type="submit" className={`${spanFullSm} ${primaryBtnClass} py-2.5 sm:py-2`}>
        Add subscription
      </button>
    </ServerActionForm>
  );
}

export function InvestmentForms({ accounts }: { accounts: Option[] }) {
  const today = getTodayIsoDate();
  const flowIds = useId();
  const snapIds = useId();

  return (
    <div className="space-y-6">
      <ServerActionForm action={createInvestmentFlowAction} className={formGridResponsive}>
        <p className={`${spanFullSm} text-sm text-slate-300`}>Record a contribution or withdrawal.</p>
        <LabeledField label="Account" hint="Investment account for this flow.">
          <select id={`${flowIds}-account`} name="accountId" className={selectClass}>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </LabeledField>
        <LabeledField label="Direction" hint="Money in or out of the account.">
          <select id={`${flowIds}-dir`} name="direction" className={selectClass}>
            <option value="CONTRIBUTION">Contribution</option>
            <option value="WITHDRAWAL">Withdrawal</option>
          </select>
        </LabeledField>
        <CurrencyAmountInput name="amount" label="Amount" placeholder="0.00" />
        <DateField name="date" label="Flow date" hint="Date for this contribution or withdrawal." defaultValue={today} />
        <LabeledField label="Note" hint="Optional (max 250 characters)." className={spanFullSm}>
          <textarea name="note" rows={3} maxLength={250} className={textAreaClass} placeholder="Optional memo" />
        </LabeledField>
        <button type="submit" className={`${spanFullSm} ${primaryBtnClass} py-2.5 sm:py-2`}>
          Add investment flow
        </button>
      </ServerActionForm>
      <ServerActionForm action={createPortfolioSnapshotAction} className={formGridResponsive}>
        <p className={`${spanFullSm} text-sm text-slate-300`}>Save a point-in-time portfolio value.</p>
        <LabeledField label="Account" hint="Which account this snapshot applies to.">
          <select id={`${snapIds}-account`} name="accountId" className={selectClass}>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </LabeledField>
        <DateField name="date" label="Snapshot date" hint="As-of date for the total value below." defaultValue={today} />
        <CurrencyAmountInput
          name="totalValue"
          label="Total portfolio value"
          placeholder="0.00"
          className={spanFullSm}
        />
        <LabeledField label="Note" hint="Optional (max 250 characters)." className={spanFullSm}>
          <textarea name="note" rows={3} maxLength={250} className={textAreaClass} placeholder="Optional context" />
        </LabeledField>
        <button type="submit" className={`${spanFullSm} ${primaryBtnClass} py-2.5 sm:py-2`}>
          Save portfolio value
        </button>
      </ServerActionForm>
    </div>
  );
}

type SettingsTabId = "profile" | "data" | "budgets" | "advanced";

const SETTINGS_TAB_META: { id: SettingsTabId; label: string; labelCompact: string; hint: string }[] = [
  {
    id: "profile",
    label: "Profile",
    labelCompact: "Profile",
    hint: "Name, region, timezone, and password",
  },
  {
    id: "data",
    label: "Import & accounts",
    labelCompact: "Import",
    hint: "CSV import and financial accounts",
  },
  {
    id: "budgets",
    label: "Budgets",
    labelCompact: "Budgets",
    hint: "Monthly limits by expense category",
  },
  {
    id: "advanced",
    label: "Advanced",
    labelCompact: "Advanced",
    hint: "Clear financial data or delete your login",
  },
];

export function SettingsForms({
  defaults,
  profileEmail,
  hasPassword,
  joinedAt,
  accounts,
  accountItems,
  expenseCategories,
  budgets,
  defaultExpenseAccountId,
}: {
  defaults: { displayName: string; countryCode: string; timezone: string };
  profileEmail: string;
  hasPassword: boolean;
  joinedAt: string;
  accounts: Option[];
  accountItems: Array<{ id: string; name: string; type: string; archived: boolean; currency: string }>;
  expenseCategories: Option[];
  budgets: Array<{ id: string; periodMonth: string; name: string | null; categoryName: string; limitCents: number }>;
  defaultExpenseAccountId: string | null;
}) {
  const [tab, setTab] = useState<SettingsTabId>("profile");
  const [editingAccount, setEditingAccount] = useState<{
    id: string;
    name: string;
    type: string;
    archived: boolean;
    currency: string;
  } | null>(null);
  const profileInitials = getProfileInitials(defaults.displayName, profileEmail);
  const joinedLabel = new Date(joinedAt).toLocaleDateString(undefined, {
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  useLayoutEffect(() => {
    const syncFromHash = () => {
      if (typeof window === "undefined") return;
      const h = window.location.hash.toLowerCase();
      if (h === "#budgets") setTab("budgets");
      else if (h === "#data" || h === "#import" || h === "#accounts") setTab("data");
      else if (h === "#advanced") setTab("advanced");
      else if (h === "#profile") setTab("profile");
    };
    syncFromHash();
    window.addEventListener("hashchange", syncFromHash);
    return () => window.removeEventListener("hashchange", syncFromHash);
  }, []);

  const activeAccountCount = accountItems.filter((a) => !a.archived).length;
  const archivedAccountCount = accountItems.filter((a) => a.archived).length;
  const budgetRowCount = budgets.length;
  const budgetTotalCents = budgets.reduce((sum, b) => sum + b.limitCents, 0);
  const defaultExpenseAccountFieldValue =
    defaultExpenseAccountId && accounts.some((a) => a.id === defaultExpenseAccountId)
      ? defaultExpenseAccountId
      : "";

  return (
    <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:gap-10">
      <nav
        className="shrink-0 border-b border-slate-800/80 pb-1 lg:sticky lg:top-24 lg:w-56 lg:self-start lg:border-b-0 lg:border-r lg:border-slate-800/90 lg:pb-0 lg:pr-8"
        aria-label="Settings sections"
      >
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500 lg:mb-3">Sections</p>
        <div
          role="tablist"
          className="flex flex-row gap-2 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden lg:flex lg:flex-col lg:gap-1.5 lg:overflow-visible lg:pb-0"
        >
          {SETTINGS_TAB_META.map((t) => {
            const selected = tab === t.id;
            return (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={selected}
                title={t.hint}
                className={`touch-manipulation rounded-xl border px-3.5 py-2.5 text-left text-sm font-medium transition sm:px-4 ${
                  selected
                    ? "border-slate-600 bg-slate-800 text-slate-50 shadow-sm ring-1 ring-slate-700/80"
                    : "border-transparent bg-slate-950/50 text-slate-400 hover:border-slate-700 hover:bg-slate-900/90 hover:text-slate-200"
                } shrink-0 whitespace-nowrap lg:w-full lg:shrink lg:whitespace-normal`}
                onClick={() => setTab(t.id)}
              >
                <span className="lg:hidden">{t.id === "data" ? t.labelCompact : t.label}</span>
                <span className="hidden lg:inline">{t.label}</span>
              </button>
            );
          })}
        </div>
      </nav>

      <div className="min-w-0 flex-1 space-y-4">
        {tab === "profile" ? (
          <div className="mx-auto max-w-2xl space-y-6" role="tabpanel" aria-label="Profile">
            <header className="space-y-2 border-b border-slate-800/80 pb-6">
              <h2 className="text-xl font-semibold tracking-tight text-slate-50 sm:text-2xl">Profile</h2>
              <p className="max-w-prose text-sm leading-relaxed text-slate-400">
                Manage how you appear in the app, your regional defaults for new accounts, and your password when you use
                email sign-in.
              </p>
            </header>

            <div className="flex flex-col gap-4 rounded-2xl border border-slate-700/80 bg-gradient-to-br from-slate-800/50 via-slate-900/80 to-slate-950 p-5 shadow-lg ring-1 ring-white/5 sm:flex-row sm:items-center sm:gap-6">
              <div
                className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-500/35 to-indigo-600/25 text-lg font-semibold tracking-tight text-blue-50 shadow-inner ring-1 ring-blue-400/25"
                aria-hidden
              >
                {profileInitials}
              </div>
              <div className="min-w-0 flex-1 space-y-1">
                <p className="truncate text-lg font-semibold text-slate-50">
                  {defaults.displayName.trim() || "Add your name"}
                </p>
                <p className="truncate text-sm text-slate-400">
                  <span className="text-slate-500">Signed in as </span>
                  <span className="font-medium text-slate-300">{profileEmail}</span>
                </p>
                <p className="text-xs text-slate-500">Member since {joinedLabel}</p>
              </div>
            </div>

            <section className="space-y-4 rounded-2xl border border-slate-800 bg-gradient-to-b from-slate-900/90 to-slate-950/80 p-5 shadow-lg sm:p-6">
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-800/90 pb-4">
                <div className="space-y-1">
                  <h3 className="flex items-center gap-2 text-base font-semibold text-slate-100">
                    <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-slate-800 text-slate-300 ring-1 ring-slate-700">
                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden>
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
                        />
                      </svg>
                    </span>
                    Personal details
                  </h3>
                  <p className="max-w-prose text-sm text-slate-400">
                    Your display name is shown in the header. Country and timezone drive defaults for new financial
                    accounts and date handling.
                  </p>
                </div>
              </div>

              <ServerActionForm action={updateProfileAction} className={`${formGridResponsive} gap-4 sm:gap-4`}>
                <LabeledField
                  label="Display name"
                  hint="Shown in the app chrome and exports. Optional but recommended."
                  className="sm:col-span-2"
                >
                  <input name="displayName" autoComplete="name" defaultValue={defaults.displayName} className={inputClass} />
                </LabeledField>
                <LabeledField
                  label="Country / region"
                  hint="ISO 3166-1 alpha-2 code (e.g. CA, US, GB). Used as the default region for new accounts."
                >
                  <input
                    name="countryCode"
                    autoComplete="country"
                    defaultValue={defaults.countryCode}
                    className={inputClass}
                    inputMode="text"
                    maxLength={2}
                    spellCheck={false}
                    placeholder="CA"
                  />
                </LabeledField>
                <LabeledField
                  label="Timezone"
                  hint="IANA name such as America/Toronto or Europe/London. Used for dates and summaries."
                >
                  <input
                    name="timezone"
                    autoComplete="off"
                    defaultValue={defaults.timezone}
                    className={inputClass}
                    placeholder="America/Toronto"
                  />
                </LabeledField>
                <div className={`${spanFullSm} flex flex-wrap gap-2 pt-1`}>
                  <button type="submit" className={primaryBtnClass}>
                    Save changes
                  </button>
                </div>
              </ServerActionForm>
            </section>

            <section className="space-y-4 rounded-2xl border border-slate-800 bg-gradient-to-b from-slate-900/90 to-slate-950/80 p-5 shadow-lg sm:p-6">
              <div className="space-y-1 border-b border-slate-800/90 pb-4">
                <h3 className="flex items-center gap-2 text-base font-semibold text-slate-100">
                  <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-slate-800 text-slate-300 ring-1 ring-slate-700">
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden>
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
                      />
                    </svg>
                  </span>
                  Security
                </h3>
                <p className="max-w-prose text-sm text-slate-400">
                  {hasPassword
                    ? "Update the password for your email login. If you also use Google, both methods stay linked to this account."
                    : "Your account does not use a saved password (for example, you may sign in only with Google)."}
                </p>
              </div>

              {hasPassword ? (
                <ServerActionForm action={changePasswordAction} className="space-y-4">
                  <LabeledField label="Current password" hint="The password you use on the login page with this email.">
                    <input
                      type="password"
                      name="currentPassword"
                      autoComplete="current-password"
                      className={inputClass}
                      required
                    />
                  </LabeledField>
                  <div className={formGridResponsive}>
                    <LabeledField label="New password" hint="Choose a strong password you have not used here before.">
                      <input
                        type="password"
                        name="newPassword"
                        autoComplete="new-password"
                        className={inputClass}
                        required
                        minLength={8}
                      />
                    </LabeledField>
                    <LabeledField label="Confirm new password" hint="Re-enter the new password to avoid typos.">
                      <input
                        type="password"
                        name="confirmPassword"
                        autoComplete="new-password"
                        className={inputClass}
                        required
                        minLength={8}
                      />
                    </LabeledField>
                  </div>
                  <div className="flex flex-wrap items-center gap-3 pt-1">
                    <button type="submit" className={primaryBtnClass}>
                      Update password
                    </button>
                    <a
                      href="/forgot-password"
                      className="text-sm font-medium text-blue-400 underline-offset-4 hover:text-blue-300 hover:underline"
                    >
                      Forgot password?
                    </a>
                  </div>
                </ServerActionForm>
              ) : (
                <div className="rounded-xl border border-slate-700/80 bg-slate-950/40 px-4 py-3 text-sm text-slate-300">
                  <p className="leading-relaxed">
                    Password changes apply when you sign in with email and password. To set a password for this email,
                    use{" "}
                    <a
                      href="/forgot-password"
                      className="font-medium text-blue-400 underline-offset-4 hover:text-blue-300 hover:underline"
                    >
                      reset password
                    </a>{" "}
                    from the login screen so you receive a link to create one.
                  </p>
                </div>
              )}
            </section>
          </div>
        ) : null}

        {tab === "data" ? (
          <div className="space-y-4" role="tabpanel" aria-label="Import and accounts">
            <ExpenseCsvImportForm
              accounts={accounts}
              expenseCategories={expenseCategories}
              defaultExpenseAccountId={defaultExpenseAccountId}
            />
            <div className="space-y-6 rounded-2xl border border-slate-800 bg-gradient-to-b from-slate-900/85 to-slate-900/55 p-4 shadow-lg lg:space-y-8 lg:p-6">
              <div className="flex flex-col gap-3 border-b border-slate-800/80 pb-4 lg:flex-row lg:items-end lg:justify-between lg:pb-5">
                <div className="min-w-0 space-y-1">
                  <h3 className="text-lg font-semibold tracking-tight text-slate-100 lg:text-xl">Your accounts</h3>
                  <p className="max-w-prose text-sm leading-relaxed text-slate-400">
                    Accounts back expenses, income, subscriptions, and CSV imports. Active accounts appear in dashboard
                    pickers; archived ones stay out of the way until you restore them.
                  </p>
                </div>
                <p className="shrink-0 text-xs tabular-nums text-slate-500">
                  {activeAccountCount} active
                  {archivedAccountCount > 0 ? ` · ${archivedAccountCount} archived` : ""}
                </p>
              </div>

              <div className="rounded-xl border border-slate-800/90 bg-slate-950/35 p-4 lg:p-5">
                <h4 className="mb-1 text-sm font-medium text-slate-200">Default expense account</h4>
                <p className="mb-4 max-w-prose text-xs leading-relaxed text-slate-500">
                  Preselects this account on the dashboard Add Expense form and in CSV import defaults. Choose None to use
                  your first active account instead.
                </p>
                <ServerActionForm action={updateDefaultExpenseAccountAction} className={`${formGridResponsive} items-end`}>
                  <LabeledField
                    label="Account"
                    hint="Only active accounts are listed. Archiving or removing an account clears this default."
                    className="sm:col-span-2"
                  >
                    <select
                      name="defaultExpenseAccountId"
                      className={selectClass}
                      defaultValue={defaultExpenseAccountFieldValue}
                    >
                      <option value="">None (first active account)</option>
                      {accounts.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name}
                        </option>
                      ))}
                    </select>
                  </LabeledField>
                  <div className="flex items-end sm:col-span-2 sm:justify-end">
                    <button type="submit" className={primaryBtnClass}>
                      Save default
                    </button>
                  </div>
                </ServerActionForm>
              </div>

              <div className="rounded-xl border border-slate-800/90 bg-slate-950/35 p-4 lg:p-5">
                <h4 className="mb-1 text-sm font-medium text-slate-200">Add a new account</h4>
                <p className="mb-4 text-xs text-slate-500">Choose a clear name and the account category that fits best.</p>
                <ServerActionForm action={createFinancialAccountAction} className={`${formGridResponsive} sm:grid-cols-2`}>
                  <LabeledField
                    label="Account name"
                    hint="Shown in lists, imports, and next to transactions."
                    className="sm:col-span-2"
                  >
                    <input name="name" placeholder="e.g. Everyday Visa, Joint chequing" className={inputClass} required />
                  </LabeledField>
                  <LabeledField label="Account type" hint="For your own organization; you can change labels anytime.">
                    <select name="type" className={selectClass} defaultValue="CHEQUING">
                      {ACCOUNT_TYPE_ORDER.map((t) => (
                        <option key={t} value={t}>
                          {ACCOUNT_TYPE_LABELS[t]}
                        </option>
                      ))}
                    </select>
                  </LabeledField>
                  <div className="flex items-end">
                    <button type="submit" className={`${primaryBtnClass} w-full sm:w-auto`}>
                      Add account
                    </button>
                  </div>
                </ServerActionForm>
              </div>

              <div className="space-y-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h4 className="text-xs font-medium uppercase tracking-wide text-slate-500">Active accounts</h4>
                  <p className="text-[11px] leading-snug text-slate-500">
                    Archive hides from pickers. Remove deletes the account row but keeps past transaction history.
                  </p>
                </div>
                {accountItems.every((a) => a.archived) ? (
                  <p className="rounded-xl border border-dashed border-slate-700 bg-slate-950/40 px-3 py-6 text-center text-sm text-slate-500">
                    No active accounts yet. Add one above, or restore an archived account.
                  </p>
                ) : null}
                <ul className="space-y-3">
                  {accountItems
                    .filter((a) => !a.archived)
                    .map((account) => (
                      <li
                        key={account.id}
                        className="rounded-xl border border-slate-800 bg-slate-950/55 p-0"
                      >
                        <button
                          type="button"
                          onClick={() => setEditingAccount(account)}
                          className="w-full rounded-xl p-3.5 text-left transition hover:bg-slate-900/40 sm:p-4"
                        >
                          <div className="min-w-0 space-y-2">
                            <p className="truncate text-base font-semibold text-slate-100">{account.name}</p>
                            <div className="flex flex-wrap items-center gap-2">
                              <AccountTypePill accountType={account.type} />
                              <span className="rounded-md border border-slate-700/80 bg-slate-900/60 px-2 py-0.5 text-[11px] font-medium tabular-nums text-slate-400">
                                {account.currency}
                              </span>
                              <span className="text-xs text-slate-500">Click to edit</span>
                            </div>
                          </div>
                        </button>
                      </li>
                    ))}
                </ul>
              </div>

              {accountItems.some((a) => a.archived) ? (
                <div className="space-y-3 border-t border-slate-800/80 pt-6">
                  <h4 className="text-xs font-medium uppercase tracking-wide text-slate-500">Archived</h4>
                  <p className="text-[11px] text-slate-500">
                    Hidden from the dashboard and import defaults. Restore anytime, or remove permanently.
                  </p>
                  <ul className="space-y-3">
                    {accountItems
                      .filter((a) => a.archived)
                      .map((account) => (
                        <li
                          key={account.id}
                          className="rounded-xl border border-slate-700/50 bg-slate-950/25 p-0"
                        >
                          <button
                            type="button"
                            onClick={() => setEditingAccount(account)}
                            className="w-full rounded-xl p-3.5 text-left transition hover:bg-slate-900/30 sm:p-4"
                          >
                            <div className="min-w-0 space-y-2">
                              <p className="truncate text-base font-semibold text-slate-200">{account.name}</p>
                              <div className="flex flex-wrap items-center gap-2">
                                <AccountTypePill accountType={account.type} />
                                <span className="rounded-md border border-slate-600/80 bg-slate-900/50 px-2 py-0.5 text-[11px] font-medium tabular-nums text-slate-500">
                                  {account.currency}
                                </span>
                                <span className="rounded-full border border-slate-600 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-500">
                                  Hidden
                                </span>
                                <span className="text-xs text-slate-500">Click to edit</span>
                              </div>
                            </div>
                          </button>
                        </li>
                      ))}
                  </ul>
                </div>
              ) : null}
            </div>
            {editingAccount && typeof document !== "undefined"
              ? createPortal(
                  <div className="fixed inset-0 z-[70] bg-black/50 p-4">
                    <div className="mx-auto mt-10 w-full max-w-2xl rounded-2xl border border-slate-700 bg-slate-950 p-4 sm:p-5">
                      <div className="mb-4 flex items-center justify-between">
                        <h4 className="text-lg font-semibold text-slate-100">Edit account</h4>
                        <button type="button" className={secondaryBtnClass} onClick={() => setEditingAccount(null)}>
                          Close
                        </button>
                      </div>
                      <ServerActionForm
                        action={updateFinancialAccountAction}
                        onSuccess={() => setEditingAccount(null)}
                        className="grid grid-cols-1 gap-3 sm:grid-cols-2"
                      >
                        <input type="hidden" name="accountId" value={editingAccount.id} />
                        <LabeledField label="Title" className="sm:col-span-2">
                          <input name="name" defaultValue={editingAccount.name} className={inputClass} required />
                        </LabeledField>
                        <LabeledField label="Type">
                          <select name="type" className={selectClass} defaultValue={editingAccount.type}>
                            {ACCOUNT_TYPE_ORDER.map((t) => (
                              <option key={t} value={t}>
                                {ACCOUNT_TYPE_LABELS[t]}
                              </option>
                            ))}
                          </select>
                        </LabeledField>
                        <LabeledField label="Currency">
                          <input name="currency" defaultValue={editingAccount.currency} maxLength={3} className={inputClass} required />
                        </LabeledField>
                        <button type="submit" className={`${primaryBtnClass} sm:col-span-2`}>
                          Save account
                        </button>
                      </ServerActionForm>
                      <div className="mt-4 flex flex-wrap gap-2 border-t border-slate-800 pt-4">
                        <ServerActionForm action={setFinancialAccountArchivedAction} onSuccess={() => setEditingAccount(null)}>
                          <input type="hidden" name="accountId" value={editingAccount.id} />
                          <input type="hidden" name="archived" value={editingAccount.archived ? "false" : "true"} />
                          <button type="submit" className={secondaryBtnClass}>
                            {editingAccount.archived ? "Restore" : "Archive"}
                          </button>
                        </ServerActionForm>
                        <ServerActionForm action={deleteFinancialAccountAction} onSuccess={() => setEditingAccount(null)}>
                          <input type="hidden" name="accountId" value={editingAccount.id} />
                          <button type="submit" className={secondaryBtnClass}>
                            Remove
                          </button>
                        </ServerActionForm>
                      </div>
                    </div>
                  </div>,
                  document.body,
                )
              : null}
          </div>
        ) : null}

        {tab === "budgets" ? (
          <div
            id="budgets"
            className="budget-settings-card scroll-mt-24 mx-auto max-w-3xl space-y-8"
            role="tabpanel"
            aria-label="Budgets"
          >
            <header className="space-y-2 border-b border-slate-800/80 pb-6">
              <h2 className="text-xl font-semibold tracking-tight text-slate-50 sm:text-2xl">Budgets</h2>
              <p className="max-w-prose text-sm leading-relaxed text-slate-400">
                Set monthly spending caps per expense category. Rolling budgets apply from their period forward; you can
                also add one-off limits for past months. Totals on the dashboard respect your date range (month, YTD,
                or lifetime).
              </p>
              <dl className="mt-4 flex flex-wrap gap-4 rounded-xl border border-slate-800/90 bg-slate-950/40 px-4 py-3 text-sm">
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">Budget rows</dt>
                  <dd className="tabular-nums text-slate-200">{budgetRowCount}</dd>
                </div>
                <div className="hidden h-8 w-px self-center bg-slate-800 sm:block" aria-hidden />
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">Sum of limits shown</dt>
                  <dd className="tabular-nums text-slate-200">{formatCurrency(budgetTotalCents)}</dd>
                </div>
              </dl>
            </header>

            <section className="space-y-4 rounded-2xl border border-slate-800 bg-gradient-to-b from-slate-900/90 to-slate-950/80 p-5 shadow-lg sm:p-6">
              <div className="border-b border-slate-800/90 pb-4">
                <h3 className="flex items-center gap-2 text-base font-semibold text-slate-100">
                  <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/25">
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden>
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                      />
                    </svg>
                  </span>
                  Add or update a budget
                </h3>
                <p className="mt-2 max-w-prose text-sm text-slate-400">
                  Tie each row to an expense category. New category names create the category if it does not exist yet.
                </p>
              </div>
              <BudgetForm expenseCategories={expenseCategories} />
            </section>

            <section className="space-y-4">
              <div className="flex flex-col gap-2 border-b border-slate-800/80 pb-3 sm:flex-row sm:items-end sm:justify-between">
                <div className="space-y-1">
                  <h3 className="flex items-center gap-2 text-base font-semibold text-slate-100">
                    <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-slate-800 text-slate-300 ring-1 ring-slate-700">
                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden>
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01"
                        />
                      </svg>
                    </span>
                    Your budgets
                  </h3>
                  <p className="max-w-prose text-sm text-slate-500">
                    Edit the label or limit anytime. Remove clears this budget row only (transactions stay intact).
                  </p>
                </div>
              </div>

              {budgets.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-700 bg-slate-950/35 px-5 py-12 text-center">
                  <p className="text-sm font-medium text-slate-300">No budgets yet</p>
                  <p className="mx-auto mt-2 max-w-md text-sm text-slate-500">
                    Create your first cap above. Pick a category you already use for expenses, or type a new name to track a
                    new bucket.
                  </p>
                </div>
              ) : (
                <ul className="space-y-4">
                  {budgets.map((budget) => {
                    const periodLabel = formatBudgetPeriodLabel(budget.periodMonth);
                    const displayName = budget.name ?? budget.categoryName;
                    return (
                      <li
                        key={budget.id}
                        className="rounded-2xl border border-slate-800 bg-gradient-to-b from-slate-900/80 to-slate-950/70 p-4 shadow-md ring-1 ring-white/5 sm:p-5"
                      >
                        <div className="mb-4 flex flex-col gap-3 border-b border-slate-800/80 pb-4 sm:flex-row sm:items-start sm:justify-between">
                          <div className="min-w-0 space-y-2">
                            <p className="truncate text-lg font-semibold text-slate-50">{budget.categoryName}</p>
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="inline-flex items-center rounded-lg border border-slate-700 bg-slate-900/80 px-2.5 py-1 text-xs font-medium tabular-nums text-slate-300">
                                {periodLabel}
                              </span>
                              <span className="text-xs text-slate-500">
                                Period code <span className="font-mono text-slate-400">{budget.periodMonth}</span>
                              </span>
                            </div>
                          </div>
                          <p className="shrink-0 text-right">
                            <span className="block text-[11px] font-medium uppercase tracking-wide text-slate-500">
                              Current limit
                            </span>
                            <span className="text-lg font-semibold tabular-nums text-emerald-300/95">
                              {formatCurrency(budget.limitCents)}
                            </span>
                          </p>
                        </div>

                        <ServerActionForm
                          action={updateBudgetAction}
                          className={`${formGridResponsive} gap-4 sm:items-end`}
                        >
                          <input type="hidden" name="budgetId" value={budget.id} />
                          <LabeledField
                            label="Budget label"
                            hint="Friendly name in lists; defaults to the category name."
                            className="sm:col-span-2"
                          >
                            <input
                              name="name"
                              defaultValue={displayName}
                              className={inputClass}
                              placeholder="Budget name"
                              required
                            />
                          </LabeledField>
                          <CurrencyAmountInput
                            name="limit"
                            label="Monthly limit"
                            defaultValue={(budget.limitCents / 100).toFixed(2)}
                            placeholder="0.00"
                            required
                          />
                          <div className="flex w-full items-stretch sm:w-auto sm:max-w-[11rem] sm:flex-col sm:justify-end">
                            <button
                              type="submit"
                              className={`inline-flex w-full items-center justify-center ${primaryBtnClass} py-2.5 sm:py-2`}
                            >
                              Save changes
                            </button>
                          </div>
                        </ServerActionForm>

                        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-slate-800/80 pt-4">
                          <p className="text-xs text-slate-500">
                            Deletes this budget rule only. Past transactions for{" "}
                            <span className="font-medium text-slate-400">{budget.categoryName}</span> are unchanged.
                          </p>
                          <ServerActionForm action={deleteBudgetAction} className="shrink-0">
                            <input type="hidden" name="budgetId" value={budget.id} />
                            <button type="submit" className={secondaryBtnClass}>
                              Remove budget
                            </button>
                          </ServerActionForm>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          </div>
        ) : null}

        {tab === "advanced" ? (
          <div className="space-y-4" role="tabpanel" aria-label="Advanced">
            <section className="space-y-3 rounded-2xl border border-sky-800/60 bg-sky-950/25 p-4 lg:p-5">
              <h3 className="text-base font-semibold text-sky-200 lg:text-lg">Backup and restore</h3>
              <p className="text-sm text-sky-100/85">
                Export all data associated with this user account to a JSON file, then import it later to restore this
                account. Import replaces this account&apos;s existing data.
              </p>
              <a
                href="/api/backup/export"
                className="inline-flex items-center justify-center rounded-xl bg-sky-700 px-3 py-2 text-sm font-medium text-white transition hover:bg-sky-600"
              >
                Export backup JSON
              </a>
              <ServerActionForm action={importUserBackupAction} className="space-y-2 rounded-xl border border-sky-800/70 bg-sky-950/35 p-3">
                <p className="text-xs text-sky-200/85">Import a previous backup JSON for this same account email.</p>
                <input
                  name="backupJson"
                  type="file"
                  accept="application/json,.json"
                  required
                  className={inputClass}
                />
                <button
                  type="submit"
                  className="rounded-xl bg-sky-700 px-3 py-2 text-sm font-medium text-white transition hover:bg-sky-600"
                >
                  Import backup JSON
                </button>
              </ServerActionForm>
            </section>
            <ServerActionForm action={clearUserFinancialDataAction} className="space-y-2 rounded-2xl border border-amber-800/60 bg-amber-950/25 p-4 lg:p-5">
              <h3 className="text-base font-semibold text-amber-200 lg:text-lg">Clear financial data</h3>
              <p className="text-sm text-amber-100/85">
                Permanently removes transactions (including splits), budgets, financial accounts, categories,
                subscriptions, investment flows, and portfolio snapshots for your login. Your email, password, OAuth
                links, profile fields (name, country, timezone), and sessions are kept. Default expense/income
                categories and starter accounts are recreated so you can keep using the app.
              </p>
              <p className="text-xs text-amber-200/70">
                Type <span className="font-mono text-amber-100">RESET FINANCIAL DATA</span> to confirm.
              </p>
              <input name="confirmation" className={inputClass} placeholder="RESET FINANCIAL DATA" autoComplete="off" />
              <button
                type="submit"
                className="rounded-xl bg-amber-700 px-3 py-2 text-sm font-medium text-white transition hover:bg-amber-600"
              >
                Clear all financial data
              </button>
            </ServerActionForm>
            <ServerActionForm action={deleteAccountAction} className="space-y-2 rounded-2xl border border-red-900/60 bg-red-950/30 p-4 lg:p-5">
              <h3 className="text-base font-semibold text-red-300 lg:text-lg">Delete account</h3>
              <p className="text-sm text-red-200/80">Type DELETE to confirm irreversible account removal.</p>
              <input name="confirmation" className={inputClass} />
              <button className="rounded-xl bg-red-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-red-500">
                Delete account
              </button>
            </ServerActionForm>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function AdminOauthForm({ googleEnabled, googleClientId }: { googleEnabled: boolean; googleClientId: string }) {
  return (
    <ServerActionForm action={updateAdminOauthSettingsAction} className="space-y-2 rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
      <h3 className="font-semibold text-slate-100">OAuth Server Settings</h3>
      <label className="flex items-center gap-2 text-slate-300">
        <input type="checkbox" name="googleEnabled" value="true" defaultChecked={googleEnabled} />
        Enable Google OAuth
      </label>
      <input name="googleClientId" defaultValue={googleClientId} placeholder="Google Client ID" className={inputClass} />
      <input name="googleClientSecret" type="password" placeholder="Google Client Secret" className={inputClass} />
      <button className={primaryBtnClass}>Save OAuth settings</button>
    </ServerActionForm>
  );
}

export function PasswordResetRequestForm() {
  return (
    <ServerActionForm action={requestPasswordResetAction} className="space-y-3">
      <input name="email" type="email" required placeholder="Email" className={inputClass} />
      <button className={primaryBtnClass}>Request reset</button>
    </ServerActionForm>
  );
}

export function PasswordResetForm() {
  return (
    <ServerActionForm action={resetPasswordAction} className="space-y-3">
      <input name="email" type="email" required placeholder="Email" className={inputClass} />
      <input name="token" required placeholder="Reset token" className={inputClass} />
      <input name="newPassword" type="password" required placeholder="New password" className={inputClass} />
      <button className={primaryBtnClass}>Reset password</button>
    </ServerActionForm>
  );
}
