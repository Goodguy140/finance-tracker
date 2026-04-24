"use client";

import { useId, useState, useSyncExternalStore, type ChangeEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { signIn, signOut } from "next-auth/react";
import { GoogleSignInForm } from "@/components/google-sign-in-form";
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
  deleteFinancialAccountAction,
  deleteAccountAction,
  requestPasswordResetAction,
  resetPasswordAction,
  signupAction,
  updateAdminOauthSettingsAction,
  updateProfileAction,
  upsertBudgetAction,
} from "@/app/actions";
import { parseImportedDate } from "@/lib/import-dates";
import { parseStatementAmount } from "@/lib/money";

type Option = { id: string; name: string };
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

export function ExpenseCsvImportForm({ accounts, expenseCategories }: { accounts: Option[]; expenseCategories: Option[] }) {
  const hasHydrated = useSyncExternalStore(noopSubscribe, () => true, () => false);
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<Array<Record<string, string>>>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [defaultAccountId, setDefaultAccountId] = useState(accounts[0]?.id ?? "");
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
    <form action={importExpensesCsvAction} className="space-y-3 rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
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
    </form>
  );
}

export function SignupForm() {
  return (
    <form action={signupAction} className="space-y-3">
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
      <button className={primaryBtnClass}>Create account</button>
    </form>
  );
}

export function LoginForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  return (
    <div className="space-y-3">
      <form
        className="space-y-3"
        onSubmit={async (e) => {
          e.preventDefault();
          await signIn("credentials", { email, password, callbackUrl: "/" });
        }}
      >
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
        <button type="submit" className={`w-full ${primaryBtnClass} py-2.5 sm:py-2`}>
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
}: {
  accounts: Option[];
  expenseCategories: Option[];
  incomeCategories: Option[];
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
            <SplitExpenseForm accounts={accounts} expenseCategories={expenseCategories} />
          ) : null}
          {activeForm === "subscription" ? (
            <SubscriptionForm accounts={accounts} expenseCategories={expenseCategories} />
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

export function ExpenseForm({ accounts, expenseCategories }: { accounts: Option[]; expenseCategories: Option[] }) {
  const today = getTodayIsoDate();
  const fieldIds = useId();

  return (
    <form action={createExpenseAction} className={formGridResponsive}>
      <LabeledField label="Account" hint="Financial account this expense is charged to.">
        <select id={`${fieldIds}-account`} name="accountId" className={selectClass}>
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
      <CurrencyAmountInput
        name="amount"
        label="Amount"
        placeholder="0.00 (negative for credits)"
      />
      <DateField
        name="date"
        label="Transaction date"
        hint="The date you assign to this purchase or charge."
        defaultValue={today}
      />
      <DateField
        name="postedDate"
        label="Posted date"
        hint="Optional. When the transaction cleared on your statement, if different from the transaction date."
        className={spanFullSm}
      />
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
      <LabeledField label="Note" hint="Optional details (max 250 characters)." className={spanFullSm}>
        <textarea name="note" rows={5} maxLength={250} className={textAreaClass} placeholder="Extra context, memo, or split notes" />
      </LabeledField>
      <p className={`${spanFullSm} text-xs leading-relaxed text-slate-400`}>
        Use a negative amount for statement credits (refunds, chargebacks). They use the same category and reduce net
        spend in budgets.
      </p>
      <button type="submit" className={`${spanFullSm} ${primaryBtnClass} py-2.5 sm:py-2`}>
        Add expense
      </button>
    </form>
  );
}

export function IncomeForm({ accounts, incomeCategories }: { accounts: Option[]; incomeCategories: Option[] }) {
  const today = getTodayIsoDate();
  const fieldIds = useId();

  return (
    <form action={createIncomeAction} className={formGridResponsive}>
      <LabeledField label="Account" hint="Account that received this income.">
        <select id={`${fieldIds}-account`} name="accountId" className={selectClass}>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </LabeledField>
      <LabeledField label="Category" hint="Income category.">
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
    </form>
  );
}

export function SplitExpenseForm({ accounts, expenseCategories }: { accounts: Option[]; expenseCategories: Option[] }) {
  const defaultCategoryId = expenseCategories[0]?.id ?? "";
  const today = getTodayIsoDate();
  const fieldIds = useId();
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
    <form action={createSplitExpenseAction} className={formGridResponsive}>
      <LabeledField label="Account" hint="Account for this split expense.">
        <select id={`${fieldIds}-account`} name="accountId" className={selectClass}>
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
    </form>
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

export function BudgetForm({ expenseCategories }: { expenseCategories: Option[] }) {
  const [isPastOverride, setIsPastOverride] = useState(false);
  const previousPeriodMonth = getPreviousPeriodMonth();
  const categorySuggestionsId = "budget-category-suggestions";

  return (
    <form action={upsertBudgetAction} className="grid grid-cols-2 gap-2">
      <input
        name="categoryName"
        list={categorySuggestionsId}
        placeholder="Category (type or choose)"
        className={`col-span-2 ${inputClass}`}
      />
      <datalist id={categorySuggestionsId}>
        {expenseCategories.map((category) => (
          <option key={category.id} value={category.name} />
        ))}
      </datalist>
      <label className="col-span-2 flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-950/50 px-3 py-2 text-sm text-slate-300">
        <input type="checkbox" checked={isPastOverride} onChange={(e) => setIsPastOverride(e.target.checked)} />
        Set a past-month override
      </label>
      {isPastOverride ? (
        <input
          type="month"
          name="periodMonth"
          max={previousPeriodMonth}
          defaultValue={previousPeriodMonth}
          className="col-span-2 w-full rounded-xl border border-slate-700 bg-slate-950/70 p-2.5 text-slate-100 placeholder:text-slate-500 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-500/20"
        />
      ) : (
        <input type="hidden" name="periodMonth" value="" />
      )}
      <p className="col-span-2 text-xs text-slate-400">
        {isPastOverride
          ? "Past override applies only to the selected historical month."
          : `This budget applies automatically from ${getCurrentPeriodMonth()} onward.`}
      </p>
      <CurrencyAmountInput name="limit" placeholder="Limit" className="col-span-2" />
      <button className={`col-span-2 ${primaryBtnClass}`}>Save budget</button>
    </form>
  );
}

export function SubscriptionForm({ accounts, expenseCategories }: { accounts: Option[]; expenseCategories: Option[] }) {
  const today = getTodayIsoDate();
  const fieldIds = useId();

  return (
    <form action={createSubscriptionAction} className={formGridResponsive}>
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
        <select id={`${fieldIds}-account`} name="accountId" className={selectClass}>
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
    </form>
  );
}

export function InvestmentForms({ accounts }: { accounts: Option[] }) {
  const today = getTodayIsoDate();
  const flowIds = useId();
  const snapIds = useId();

  return (
    <div className="space-y-6">
      <form action={createInvestmentFlowAction} className={formGridResponsive}>
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
      </form>
      <form action={createPortfolioSnapshotAction} className={formGridResponsive}>
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
      </form>
    </div>
  );
}

export function SettingsForms({
  defaults,
  accounts,
  accountItems,
  expenseCategories,
  budgets,
}: {
  defaults: { displayName: string; countryCode: string; timezone: string };
  accounts: Option[];
  accountItems: Array<{ id: string; name: string; type: string }>;
  expenseCategories: Option[];
  budgets: Array<{ id: string; periodMonth: string; categoryName: string; limitCents: number }>;
}) {
  return (
    <div className="space-y-4">
      <ExpenseCsvImportForm accounts={accounts} expenseCategories={expenseCategories} />
      <div className="space-y-2 rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
        <h3 className="font-semibold text-slate-100">Accounts</h3>
        <form action={createFinancialAccountAction} className="grid grid-cols-2 gap-2">
          <input name="name" placeholder="Account name" className={`col-span-2 ${inputClass}`} />
          <select name="type" className={selectClass}>
            <option value="CHEQUING">Chequing</option>
            <option value="SAVINGS">Savings</option>
            <option value="CREDIT_CARD">Credit card</option>
            <option value="TFSA">TFSA</option>
            <option value="RRSP">RRSP</option>
            <option value="FHSA">FHSA</option>
            <option value="NON_REGISTERED">Non-registered</option>
            <option value="CASH">Cash</option>
          </select>
          <button className={primaryBtnClass}>Add account</button>
        </form>
        <div className="space-y-2">
          {accountItems.map((account) => (
            <div key={account.id} className="flex items-center justify-between rounded-xl border border-slate-800 bg-slate-950/50 p-2.5 text-sm">
              <p className="text-slate-200">{account.name} ({account.type})</p>
              <form action={deleteFinancialAccountAction}>
                <input type="hidden" name="accountId" value={account.id} />
                <button className={secondaryBtnClass}>Remove</button>
              </form>
            </div>
          ))}
        </div>
      </div>
      <div id="budgets" className="budget-settings-card scroll-mt-6 space-y-2 rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
        <h3 className="font-semibold text-slate-100">Budgets</h3>
        <p className="text-sm text-slate-400">One rolling budget with category entries. Type a category to create one, or pick a suggested match.</p>
        <BudgetForm expenseCategories={expenseCategories} />
        <div className="space-y-2">
          <h4 className="text-sm font-medium text-slate-200">All budgets</h4>
          {budgets.map((budget) => (
            <div key={budget.id} className="rounded-xl border border-slate-800 bg-slate-950/50 p-2.5 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-medium text-slate-100">{budget.categoryName}</p>
                <strong className="text-slate-100">CAD ${(budget.limitCents / 100).toFixed(2)}</strong>
              </div>
              <p className="text-xs text-slate-400">{budget.categoryName} - {budget.periodMonth}</p>
            </div>
          ))}
        </div>
      </div>
      <form action={updateProfileAction} className="space-y-2 rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
        <h3 className="font-semibold text-slate-100">Profile</h3>
        <input name="displayName" defaultValue={defaults.displayName} className={inputClass} />
        <input name="countryCode" defaultValue={defaults.countryCode} className={inputClass} />
        <input name="timezone" defaultValue={defaults.timezone} className={inputClass} />
        <button className={primaryBtnClass}>Save profile</button>
      </form>
      <form action={changePasswordAction} className="space-y-2 rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
        <h3 className="font-semibold text-slate-100">Change Password</h3>
        <input type="password" name="currentPassword" placeholder="Current password" className={inputClass} />
        <input type="password" name="newPassword" placeholder="New password" className={inputClass} />
        <input type="password" name="confirmPassword" placeholder="Confirm new password" className={inputClass} />
        <button className={primaryBtnClass}>Update password</button>
      </form>
      <form action={clearUserFinancialDataAction} className="space-y-2 rounded-2xl border border-amber-800/60 bg-amber-950/25 p-4">
        <h3 className="font-semibold text-amber-200">Clear financial data</h3>
        <p className="text-sm text-amber-100/85">
          Permanently removes transactions (including splits), budgets, financial accounts, categories, subscriptions,
          investment flows, and portfolio snapshots for your login. Your email, password, OAuth links, profile fields
          (name, country, timezone), and sessions are kept. Default expense/income categories and starter accounts are
          recreated so you can keep using the app.
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
      </form>
      <form action={deleteAccountAction} className="space-y-2 rounded-2xl border border-red-900/60 bg-red-950/30 p-4">
        <h3 className="font-semibold text-red-300">Delete Account</h3>
        <p className="text-sm text-red-200/80">Type DELETE to confirm irreversible account removal.</p>
        <input name="confirmation" className={inputClass} />
        <button className="rounded-xl bg-red-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-red-500">Delete account</button>
      </form>
    </div>
  );
}

export function AdminOauthForm({ googleEnabled, googleClientId }: { googleEnabled: boolean; googleClientId: string }) {
  return (
    <form action={updateAdminOauthSettingsAction} className="space-y-2 rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
      <h3 className="font-semibold text-slate-100">OAuth Server Settings</h3>
      <label className="flex items-center gap-2 text-slate-300">
        <input type="checkbox" name="googleEnabled" value="true" defaultChecked={googleEnabled} />
        Enable Google OAuth
      </label>
      <input name="googleClientId" defaultValue={googleClientId} placeholder="Google Client ID" className={inputClass} />
      <input name="googleClientSecret" type="password" placeholder="Google Client Secret" className={inputClass} />
      <button className={primaryBtnClass}>Save OAuth settings</button>
    </form>
  );
}

export function PasswordResetRequestForm() {
  return (
    <form action={requestPasswordResetAction} className="space-y-3">
      <input name="email" type="email" required placeholder="Email" className={inputClass} />
      <button className={primaryBtnClass}>Request reset</button>
    </form>
  );
}

export function PasswordResetForm() {
  return (
    <form action={resetPasswordAction} className="space-y-3">
      <input name="email" type="email" required placeholder="Email" className={inputClass} />
      <input name="token" required placeholder="Reset token" className={inputClass} />
      <input name="newPassword" type="password" required placeholder="New password" className={inputClass} />
      <button className={primaryBtnClass}>Reset password</button>
    </form>
  );
}
