"use client";

import { useEffect, useId, useImperativeHandle, useRef, useState, useSyncExternalStore, type RefObject } from "react";
import { createPortal } from "react-dom";
import { ServerActionForm } from "@/components/server-action-form";
import { ExpenseTitleAutocomplete } from "@/components/expense-title-autocomplete";
import { parseImportedDate } from "@/lib/import-dates";
import { parseStatementAmount } from "@/lib/money";
import { MOBILE_OVERLAY_ROOT_Z_CLASS, MOBILE_OVERLAY_SHEET_Z_CLASS } from "@/lib/mobile-z-index";
import {
  inputClass,
  selectClass,
  textAreaClass,
  formGridResponsive,
  spanFullSm,
  primaryBtnClass,
  secondaryBtnClass,
  LabeledField,
  FieldHintModeProvider,
  CurrencyAmountInput,
  DateField,
  type Option,
  noopSubscribe,
  parseCsvText,
  defaultExpenseAccountSelectValue,
  getTodayIsoDate,
  CSV_PREVIEW_ALL_MAX,
  importTargetsForHeader,
  floatingFieldLabelClass,
} from "./shared";
import type { ExpenseTitleSuggestion } from "@/lib/expense-title-suggestions";
import type { RuleOutcome } from "@/lib/transaction-rules";
import { RuleAutofillHint, useRuleAutofill } from "@/components/transaction-rules-context";
import { createExpenseAction, importExpensesCsvAction, createSplitExpenseAction } from "@/app/actions";
import type { AddMenuFormKey } from "./auth-forms";
import { IncomeForm } from "./income-forms";
import { RecurringTransactionForm, InvestmentForms } from "./settings-forms";
import type { ContributionRoomData } from "@/lib/contribution-room";

export function ExpenseTitleAndCategoryFields({
  expenseCategories,
  titleSuggestions,
  defaultTitle = "",
  defaultCategoryId,
  fieldIds,
  accounts,
  accountSelectDefault,
  accountRemovedFallback,
  amountCents = null,
  onRuleFill,
  reevaluateRef,
}: {
  expenseCategories: Option[];
  titleSuggestions: ExpenseTitleSuggestion[];
  defaultTitle?: string;
  defaultCategoryId?: string;
  fieldIds: string;
  /** When provided, Account is shown beside Category from `sm` breakpoint up. */
  accounts?: Option[];
  accountSelectDefault?: string;
  /** Edit flow: previous account was removed — allow empty selection until user picks one. */
  accountRemovedFallback?: boolean;
  /** The amount entered so far, for rules with an amount condition. */
  amountCents?: number | null;
  /** Fields this component does not own (amount, note), for the parent to fill. */
  onRuleFill?: (outcome: RuleOutcome) => void;
  /** Lets the parent re-run the rules when a field it owns (the amount) changes. */
  reevaluateRef?: RefObject<(() => void) | null>;
}) {
  const initialCategoryId =
    defaultCategoryId && expenseCategories.some((c) => c.id === defaultCategoryId)
      ? defaultCategoryId
      : (expenseCategories[0]?.id ?? "");
  const [categoryId, setCategoryId] = useState(initialCategoryId);

  // React 19 automatically calls the native form.reset() after a successful server
  // action (see ServerActionForm). That reverts this controlled <select> in the DOM
  // to its first option without changing `categoryId`, so nothing re-syncs it until an
  // unrelated re-render — the "category resets until another field is edited" bug.
  // Remounting the select on the form's reset event re-applies the tracked category.
  const selectRef = useRef<HTMLSelectElement>(null);
  const [resetNonce, setResetNonce] = useState(0);
  useEffect(() => {
    const form = selectRef.current?.form;
    if (!form) return;
    const onReset = () => setResetNonce((n) => n + 1);
    form.addEventListener("reset", onReset);
    return () => form.removeEventListener("reset", onReset);
  }, []);

  const [accountId, setAccountId] = useState(accountSelectDefault ?? "");
  const titleRef = useRef(defaultTitle);
  const rules = useRuleAutofill({ type: "EXPENSE", categoryOptions: expenseCategories, learned: titleSuggestions });

  function applyRules(title: string, nextAccountId = accountId) {
    titleRef.current = title;
    const { outcome, fresh } = rules.evaluate({ texts: [title], amountCents, accountId: nextAccountId || null });
    if (!fresh) return;
    if (outcome.categoryId && expenseCategories.some((c) => c.id === outcome.categoryId)) {
      setCategoryId(outcome.categoryId);
    }
    if (outcome.accountId && accounts?.some((a) => a.id === outcome.accountId)) {
      setAccountId(outcome.accountId);
    }
    onRuleFill?.(outcome);
  }

  // No deps on purpose: the handle must close over this render's amount and account.
  useImperativeHandle(reevaluateRef, () => () => applyRules(titleRef.current));

  /** A rename is offered once the person leaves the field, so it never fights their typing. */
  function renameFromRules(title: string) {
    return rules.peek({ texts: [title], amountCents, accountId: accountId || null }).title;
  }

  const categoryField = (
    <LabeledField label="Category" hint="Expense category for budgeting and reports.">
      <select
        key={resetNonce}
        ref={selectRef}
        id={`${fieldIds}-category`}
        name="categoryId"
        className={selectClass}
        value={categoryId}
        onChange={(e) => setCategoryId(e.target.value)}
        required
      >
        {expenseCategories.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
    </LabeledField>
  );

  const accountField =
    accounts && accounts.length > 0 ? (
      <LabeledField label="Account" hint="Financial account this expense is charged to.">
        <select
          key={resetNonce}
          id={`${fieldIds}-account`}
          name="accountId"
          className={selectClass}
          value={accountId}
          onChange={(e) => {
            setAccountId(e.target.value);
            applyRules(titleRef.current, e.target.value);
          }}
          required
        >
          {accountRemovedFallback ? (
            <option value="" disabled>
              Choose account (previous account was removed)
            </option>
          ) : null}
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </LabeledField>
    ) : null;

  return (
    <>
      <LabeledField
        label="Title"
        hint="Required. Pick a previous title or type a new one; category updates when you match a past entry."
        hintInline
        className={`${spanFullSm} mb-3`}
      >
        <ExpenseTitleAutocomplete
          inputId={`${fieldIds}-title`}
          defaultValue={defaultTitle}
          titleSuggestions={titleSuggestions}
          expenseCategories={expenseCategories}
          onTitleChange={applyRules}
          renameOnBlur={renameFromRules}
          required
        />
        <RuleAutofillHint outcome={rules.outcome} />
      </LabeledField>
      {accountField ? (
        <div className="grid w-full grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-3">
          {categoryField}
          {accountField}
        </div>
      ) : (
        categoryField
      )}
    </>
  );
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
        <h3 className="font-semibold text-slate-100">Import expenses from CSV</h3>
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


function subscribeMobileViewport(onStoreChange: () => void) {
  const mediaQuery = window.matchMedia("(max-width: 639px)");
  mediaQuery.addEventListener("change", onStoreChange);
  return () => mediaQuery.removeEventListener("change", onStoreChange);
}

function readMobileViewport() {
  return window.matchMedia("(max-width: 639px)").matches;
}

export function AddFormsDropdown({
  accounts,
  expenseCategories,
  incomeCategories,
  defaultExpenseAccountId,
  contributionRoom,
}: {
  accounts: Option[];
  expenseCategories: Option[];
  incomeCategories: Option[];
  defaultExpenseAccountId?: string | null;
  contributionRoom?: ContributionRoomData;
}) {
  const [open, setOpen] = useState(false);
  const [activeForm, setActiveForm] = useState<AddMenuFormKey>("income");
  const isMobileViewport = useSyncExternalStore(subscribeMobileViewport, readMobileViewport, () => true);

  const menuPanel = (
    <>
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
          onClick={() => setActiveForm("recurring")}
          className={`rounded-lg px-2.5 py-1.5 text-xs font-medium transition ${
            activeForm === "recurring" ? "bg-blue-500 text-white" : "bg-slate-800 text-slate-300 hover:bg-slate-700"
          }`}
        >
          Recurring
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
      {activeForm === "recurring" ? (
        <RecurringTransactionForm
          accounts={accounts}
          expenseCategories={expenseCategories}
          incomeCategories={incomeCategories}
          defaultExpenseAccountId={defaultExpenseAccountId}
        />
      ) : null}
      {activeForm === "investment" ? <InvestmentForms accounts={accounts} contributionRoom={contributionRoom} /> : null}

      <div className="mt-4 flex justify-end sm:mt-3">
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="w-full touch-manipulation rounded-xl border border-slate-700 bg-slate-900 px-3 py-2.5 text-sm font-medium text-slate-300 transition hover:bg-slate-800 sm:w-auto sm:rounded-lg sm:px-2.5 sm:py-1.5 sm:text-xs"
        >
          Close
        </button>
      </div>
    </>
  );

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
      {open ? (
        isMobileViewport && typeof document !== "undefined"
          ? createPortal(
              <>
                <button
                  type="button"
                  className={`fixed inset-0 ${MOBILE_OVERLAY_ROOT_Z_CLASS} bg-black/50`}
                  aria-label="Close add menu"
                  onClick={() => setOpen(false)}
                />
                <div
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby="add-menu-title"
                  className={`fixed inset-x-0 bottom-0 ${MOBILE_OVERLAY_SHEET_Z_CLASS} max-h-[min(calc(100dvh-env(safe-area-inset-top,0px)-12px),42rem)] overflow-y-auto overscroll-contain rounded-t-2xl border border-slate-700 bg-slate-950/98 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-2xl backdrop-blur`}
                >
                  {menuPanel}
                </div>
              </>,
              document.body,
            )
          : (
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="add-menu-title"
              className="absolute right-0 top-full z-[60] mt-2 max-h-[min(85vh,40rem)] w-[min(92vw,32rem)] overflow-y-auto overscroll-contain rounded-2xl border border-slate-700 bg-slate-950/98 p-4 shadow-2xl backdrop-blur"
            >
              {menuPanel}
            </div>
          )
      ) : null}
    </div>
  );
}

export function ExpenseForm({
  accounts,
  expenseCategories,
  defaultExpenseAccountId,
  titleSuggestions = [],
  variant = "default",
  onSuccess,
  fieldDefaults,
}: {
  accounts: Option[];
  expenseCategories: Option[];
  defaultExpenseAccountId?: string | null;
  titleSuggestions?: ExpenseTitleSuggestion[];
  variant?: "default" | "mobileSheet";
  onSuccess?: () => void;
  /**
   * Which optional fields start open, from the Add Expense card's settings. Only seeds the
   * initial state — the pills still toggle freely per entry. All default to closed, which is
   * how the form behaved before the setting existed.
   */
  fieldDefaults?: {
    showPostedDate?: boolean;
    showNote?: boolean;
    showReceiptBreakdown?: boolean;
  };
}) {
  const today = getTodayIsoDate();
  const fieldIds = useId();
  const accountSelectDefault = defaultExpenseAccountSelectValue(accounts, defaultExpenseAccountId);
  const [receiptBreakdown, setReceiptBreakdown] = useState(fieldDefaults?.showReceiptBreakdown ?? false);
  const [showPostedDate, setShowPostedDate] = useState(fieldDefaults?.showPostedDate ?? false);
  const [showNote, setShowNote] = useState(fieldDefaults?.showNote ?? false);
  // Controlled so the chosen date sticks across entries instead of snapping back to
  // today on React's automatic form reset — handy for batch-entering past transactions.
  const [dateValue, setDateValue] = useState(today);
  const [amountValue, setAmountValue] = useState("");
  // The note stays uncontrolled (React's post-submit form reset clears it); a rule's note is
  // written straight into the field, or seeds it when the field is not open yet.
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const [noteSeed, setNoteSeed] = useState("");
  const reevaluateRules = useRef<(() => void) | null>(null);
  const [preCreditValue, setPreCreditValue] = useState("");
  const [creditRows, setCreditRows] = useState<string[]>([""]);
  const creditSum = sumCredits(creditRows);
  const preCreditNumber = Number(preCreditValue);
  const hasValidPreCredit = Number.isFinite(preCreditNumber);
  const netPaidPreview = hasValidPreCredit ? preCreditNumber - creditSum : null;

  const formLayoutClass =
    variant === "mobileSheet" ? "flex flex-col gap-4" : formGridResponsive;

  const amountOrder = variant === "mobileSheet" ? "order-1" : "max-sm:order-1 sm:order-4";
  const titleCatOrder = variant === "mobileSheet" ? "order-2" : "max-sm:order-2 sm:order-1";
  const togglesOrder = variant === "mobileSheet" ? "order-3" : "max-sm:order-3 sm:order-3";
  const dateOrder = variant === "mobileSheet" ? "order-4" : "max-sm:order-4 sm:order-5";
  const postedOrder = variant === "mobileSheet" ? "order-5" : "max-sm:order-5 sm:order-6";
  const noteOrder = variant === "mobileSheet" ? "order-6" : "max-sm:order-6 sm:order-7";
  const submitOrder = variant === "mobileSheet" ? "order-7" : "max-sm:order-7 sm:order-8";

  const amountNumber = Number(amountValue);
  const amountCents =
    !receiptBreakdown && amountValue.trim() !== "" && Number.isFinite(amountNumber)
      ? Math.round(amountNumber * 100)
      : null;

  /** A rule only fills the amount and note while they are still empty. */
  function fillFromRules(outcome: RuleOutcome) {
    if (outcome.amountCents !== undefined && !receiptBreakdown && amountValue.trim() === "") {
      setAmountValue((outcome.amountCents / 100).toFixed(2));
    }
    if (outcome.appendNote) {
      if (noteRef.current) {
        if (!noteRef.current.value.trim()) noteRef.current.value = outcome.appendNote;
      } else {
        setNoteSeed(outcome.appendNote);
        setShowNote(true);
      }
    }
  }

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
    <FieldHintModeProvider mode="info">
    <ServerActionForm action={createExpenseAction} className={formLayoutClass} onSuccess={onSuccess}>
      <div className={`${titleCatOrder} ${spanFullSm}`}>
        <ExpenseTitleAndCategoryFields
          fieldIds={fieldIds}
          expenseCategories={expenseCategories}
          titleSuggestions={titleSuggestions}
          accounts={accounts}
          accountSelectDefault={accountSelectDefault}
          amountCents={amountCents}
          onRuleFill={fillFromRules}
          reevaluateRef={reevaluateRules}
        />
      </div>

      <div className={`${amountOrder} ${spanFullSm}`}>
        {!receiptBreakdown ? (
          <>
            <LabeledField
              label="Amount"
              hint="Tip: use a negative amount for full refunds or chargebacks."
              hintInline
            >
              <CurrencyAmountInput
                name="amount"
                placeholder="0.00 (negative for credits)"
                value={amountValue}
                onChange={(e) => setAmountValue(e.target.value)}
                onBlur={() => reevaluateRules.current?.()}
                required
              />
            </LabeledField>
            <input type="hidden" name="preCreditTotal" value="" />
            <input type="hidden" name="creditTotal" value="" />
          </>
        ) : (
          <div
            className={`space-y-4 rounded-xl border border-emerald-500/20 bg-gradient-to-br from-slate-950/80 to-slate-900/40 p-4 ring-1 ring-emerald-500/10 sm:p-5`}
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
                          className="shrink-0 min-h-11 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-slate-300 hover:bg-slate-800 sm:min-h-0 sm:px-2 sm:py-1"
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
                  className="min-h-11 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2.5 text-xs font-medium text-slate-200 transition hover:bg-slate-800 sm:min-h-0 sm:px-2.5 sm:py-1.5"
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
              automatically sum all credits and save your paid amount as{" "}
              <span className="font-medium text-slate-300">total minus combined credits</span>.
            </p>
            <input type="hidden" name="amount" value="" />
          </div>
        )}
      </div>

      <div className={`${dateOrder} ${spanFullSm}`}>
        <DateField
          name="date"
          label="Transaction date"
          hint="The date you assign to this purchase or charge."
          value={dateValue}
          onChange={setDateValue}
          required
        />
      </div>

      <div className={`${togglesOrder} ${spanFullSm} flex flex-wrap gap-2`}>
        <button
          type="button"
          onClick={() => setShowPostedDate((v) => !v)}
          className={`min-h-11 rounded-full border px-3 py-2 text-xs font-medium transition touch-manipulation sm:min-h-0 sm:py-1.5 ${
            showPostedDate
              ? "border-blue-500/40 bg-blue-500/15 text-blue-100"
              : "border-slate-700/80 bg-slate-950/50 text-slate-300 hover:bg-slate-900/70"
          }`}
        >
          Posted date
        </button>
        <button
          type="button"
          onClick={() => setShowNote((v) => !v)}
          className={`min-h-11 rounded-full border px-3 py-2 text-xs font-medium transition touch-manipulation sm:min-h-0 sm:py-1.5 ${
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
          className={`min-h-11 rounded-full border px-3 py-2 text-xs font-medium transition touch-manipulation sm:min-h-0 sm:py-1.5 ${
            receiptBreakdown
              ? "border-emerald-500/45 bg-emerald-500/15 text-emerald-100"
              : "border-slate-700/80 bg-slate-950/50 text-slate-300 hover:bg-slate-900/70"
          }`}
        >
          Receipt breakdown
        </button>
      </div>

      {showPostedDate ? (
        <div className={`${postedOrder} ${spanFullSm}`}>
          <DateField
            name="postedDate"
            label="Posted date"
            hint="Optional. When the transaction cleared on your statement, if different from the transaction date."
            hintInline
          />
        </div>
      ) : (
        <input type="hidden" name="postedDate" value="" />
      )}
      {showNote ? (
        <LabeledField
          label="Note"
          hint="Optional details (max 250 characters)."
          className={`${noteOrder} ${spanFullSm}`}
        >
          <textarea
            ref={noteRef}
            name="note"
            rows={4}
            maxLength={250}
            defaultValue={noteSeed}
            className={textAreaClass}
            placeholder="Extra context, memo, or split notes"
          />
        </LabeledField>
      ) : (
        <input type="hidden" name="note" value="" />
      )}
      <button type="submit" className={`${submitOrder} ${spanFullSm} ${primaryBtnClass} py-2.5 sm:py-2`}>
        Add expense
      </button>
    </ServerActionForm>
    </FieldHintModeProvider>
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
