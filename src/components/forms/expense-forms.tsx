"use client";

import { useEffect, useId, useImperativeHandle, useRef, useState, useSyncExternalStore, type RefObject } from "react";
import { ServerActionForm } from "@/components/server-action-form";
import { CsvImportSummaryDialog } from "./csv-import-summary-dialog";
import { isCsvImportSummary, statementOutflow, type AmountSign, type CsvImportSummary, type MoneyInAs } from "@/lib/csv-import";
import { looksLikeOfx, OFX_AMOUNT_SIGN, parseOfx } from "@/lib/ofx";
import { ExpenseTitleAutocomplete } from "@/components/expense-title-autocomplete";
import { parseImportedDate } from "@/lib/import-dates";
import { parseStatementAmount } from "@/lib/money";
import {
  inputClass,
  selectClass,
  textAreaClass,
  formGridResponsive,
  spanFullSm,
  primaryBtnClass,
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
import { describeRuleSplit, type RuleOutcome } from "@/lib/transaction-rules";
import { RuleAutofillHint, useRuleAutofill, useTagOptions } from "@/components/transaction-rules-context";
import { TagInput, type TagInputHandle } from "@/components/tag-input";
import { createExpenseAction, importExpensesCsvAction } from "@/app/actions";

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
  hideCategory = false,
  offerRuleSplit = false,
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
  /** A split expense's category comes from its lines, edited by the parent. */
  hideCategory?: boolean;
  /** Adding, not editing: a rule's split is offered, and saved when kept. */
  offerRuleSplit?: boolean;
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

  const categoryField = hideCategory ? null : (
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
      {offerRuleSplit ? (
        <RuleSplitOffer outcome={rules.outcome} categoryId={categoryId} expenseCategories={expenseCategories} />
      ) : null}
      {hideCategory ? <input type="hidden" name="categoryId" value={categoryId} /> : null}
      {accountField && categoryField ? (
        <div className="grid w-full grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-3">
          {categoryField}
          {accountField}
        </div>
      ) : (
        (categoryField ?? accountField)
      )}
    </>
  );
}


/**
 * A rule's split for the expense being added: shown while the category is the one the split
 * gave it, and saved as the rule's split (the server works the cents out from the amount
 * saved). Choosing another category, or "Book whole", adds it in one category instead.
 */
function RuleSplitOffer({
  outcome,
  categoryId,
  expenseCategories,
}: {
  outcome: RuleOutcome | null;
  categoryId: string;
  expenseCategories: Option[];
}) {
  const [declinedRuleId, setDeclinedRuleId] = useState<string | null>(null);
  const split = outcome?.split;
  const ruleId = outcome?.splitRuleId;
  if (!split || !ruleId || categoryId !== split[0].categoryId) return null;
  if (declinedRuleId === ruleId) return null;
  const name = (id: string) => expenseCategories.find((c) => c.id === id)?.name ?? "Deleted category";
  return (
    <div
      className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-blue-500/25 bg-blue-500/5 px-3 py-2 text-xs text-blue-100"
      data-testid="rule-split-offer"
    >
      <input type="hidden" name="splitRuleId" value={ruleId} />
      <span>Split by your rule: {describeRuleSplit(split, name)}</span>
      <button
        type="button"
        className="rounded-md border border-slate-700 px-2 py-1 text-slate-200 hover:bg-slate-800"
        onClick={() => setDeclinedRuleId(ruleId)}
      >
        Book whole
      </button>
    </div>
  );
}

export function ExpenseCsvImportForm({
  accounts,
  expenseCategories,
  incomeCategories = [],
  defaultExpenseAccountId,
}: {
  accounts: Option[];
  expenseCategories: Option[];
  incomeCategories?: Option[];
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
  const [importSummary, setImportSummary] = useState<CsvImportSummary | null>(null);
  const [amountSign, setAmountSign] = useState<AmountSign>("spending-positive");
  const [moneyIn, setMoneyIn] = useState<MoneyInAs>("refund");
  const [incomeCategoryId, setIncomeCategoryId] = useState(incomeCategories[0]?.id ?? "");

  const selectedColumns = {
    amount: headers.find((header) => mapping[header] === "amount") ?? "",
    amountIn: headers.find((header) => mapping[header] === "amountIn") ?? "",
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
  const incomeCategoryName = incomeCategories.find((category) => category.id === incomeCategoryId)?.name ?? "Income";
  const effectivePreviewCount =
    previewRowLimit === "all"
      ? Math.min(rows.length, CSV_PREVIEW_ALL_MAX)
      : Math.min(Math.max(1, Number(previewRowLimit) || 8), rows.length);
  const previewRows = rows.slice(0, effectivePreviewCount).map((row, index) => {
    const amountRaw = [selectedColumns.amount, selectedColumns.amountIn]
      .map((column) => (column ? (row[column] ?? "").trim() : ""))
      .filter(Boolean)
      .join(" / ");
    // Money out of the account, negative for money in: the sign the import books by.
    const amountParsed = selectedColumns.amount
      ? statementOutflow(row, selectedColumns, amountSign, parseStatementAmount)
      : null;
    const asIncome = moneyIn === "income" && amountParsed !== null && amountParsed < 0;
    const dateRawFromCsv = selectedColumns.date ? (row[selectedColumns.date] ?? "").trim() : "";
    const dateRaw = dateRawFromCsv || manualDate;
    // With a date column or manual date in play, a row without a readable date is skipped
    // (the import says which); only a file with no date source at all is booked today.
    const hasDateSource = Boolean(selectedColumns.date || manualDate);
    const dateMissing = hasDateSource && !dateRaw;
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
    const category = asIncome
      ? `${incomeCategoryName} (income)`
      : selectedColumns.categoryName
        ? (row[selectedColumns.categoryName] ?? "").trim() || manualCategoryName || defaultCategoryName
        : manualCategoryName || defaultCategoryName;
    const hasAmount = amountRaw.length > 0;
    const validAmount = hasAmount && amountParsed !== null;
    let status = "Ready";
    if (!hasAmount) status = "Skipped: missing amount";
    else if (!validAmount) status = "Skipped: invalid amount";
    else if (dateMissing) status = "Skipped: missing date";
    else if (!dateValid) status = "Skipped: invalid date";
    else if (!postedDateValid) status = "Skipped: invalid posted date";

    return {
      key: `preview-row-${index}`,
      amount:
        amountParsed === null
          ? amountRaw || "-"
          : asIncome
            ? `+${(-amountParsed).toFixed(2)}`
            : amountParsed.toFixed(2),
      date: dateRaw || (hasDateSource ? "-" : "Today"),
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
    <ServerActionForm
      action={importExpensesCsvAction}
      onSuccess={(result) => {
        if (isCsvImportSummary(result)) setImportSummary(result);
      }}
      className="space-y-3 rounded-2xl border border-slate-800 bg-slate-900/70 p-4"
    >
      {importSummary ? (
        <CsvImportSummaryDialog summary={importSummary} onClose={() => setImportSummary(null)} />
      ) : null}
      <div>
        <h3 className="font-semibold text-slate-100">Import transactions from a file</h3>
        <p className="text-xs text-slate-400">
          Upload a CSV, or an OFX or QFX statement from your bank, check how each column is read, and import. Money
          coming in (refunds, deposits) may appear as negative amounts, parentheses such as{" "}
          <code className="text-slate-300">(12.34)</code>, or a separate credit column. Choose below whether it
          lowers spending as a refund or is booked as income.
        </p>
      </div>

      <input
        type="file"
        accept=".csv,text/csv,.ofx,.qfx,application/x-ofx"
        aria-label="Statement file"
        className={inputClass}
        onChange={async (event) => {
          const file = event.target.files?.[0];
          if (!file) return;
          const text = await file.text();
          const ofx = looksLikeOfx(file.name, text);
          const parsed = ofx ? parseOfx(text) : parseCsvText(text);
          // OFX amounts are signed from the account's side: negative is money out.
          setAmountSign(ofx ? OFX_AMOUNT_SIGN : "spending-positive");
          if (parsed.headers.length === 0 || parsed.rows.length === 0) {
            setError(ofx ? "No transactions were found in this statement." : "CSV needs a header row and at least one data row.");
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
            if (normalized.includes("amount") || normalized === "debit" || normalized === "withdrawals") field = "amount";
            else if (normalized === "credit" || normalized === "deposits" || normalized === "moneyin") field = "amountIn";
            else if (normalized === "memo" && ofx) field = "note";
            else if (normalized === "type" || normalized === "id") field = "";
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
              <span className={floatingFieldLabelClass}>Amounts in the file</span>
              <select
                name="amountSign"
                className={`${selectClass} pt-3`}
                value={amountSign}
                disabled={Boolean(selectedColumns.amountIn)}
                onChange={(event) => setAmountSign(event.target.value as AmountSign)}
              >
                <option value="spending-positive">Spending is positive</option>
                <option value="spending-negative">Spending is negative (most bank exports)</option>
              </select>
            </label>
            <label className="block">
              <span className={floatingFieldLabelClass}>Money coming in</span>
              <select
                name="moneyIn"
                className={`${selectClass} pt-3`}
                value={moneyIn}
                onChange={(event) => setMoneyIn(event.target.value as MoneyInAs)}
              >
                <option value="refund">Refunds: lower spending in their category</option>
                <option value="income" disabled={incomeCategories.length === 0}>
                  Income: book as income
                </option>
              </select>
            </label>
            {moneyIn === "income" ? (
              <label className="block sm:col-span-2">
                <span className={floatingFieldLabelClass}>Income category</span>
                <select
                  name="defaultIncomeCategoryId"
                  className={`${selectClass} pt-3`}
                  value={incomeCategoryId}
                  onChange={(event) => setIncomeCategoryId(event.target.value)}
                >
                  {incomeCategories.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            {selectedColumns.amountIn ? <input type="hidden" name="amountSign" value={amountSign} /> : null}
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
          <input type="hidden" name="map_amountIn" value={selectedColumns.amountIn} />
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
        Import
      </button>
    </ServerActionForm>
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
  const tagOptions = useTagOptions();
  const tagInput = useRef<TagInputHandle>(null);
  const [showTags, setShowTags] = useState(false);
  // Tags a rule added before the field was open: seeded when it opens.
  const [tagSeed, setTagSeed] = useState<string[]>([]);
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
    const tagNames = tagOptions.namesFor(outcome.tagIds);
    if (tagNames.length > 0) {
      if (tagInput.current) {
        tagInput.current.add(tagNames);
      } else {
        setTagSeed(tagNames);
        setShowTags(true);
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
          offerRuleSplit
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
          onClick={() => setShowTags((v) => !v)}
          className={`min-h-11 rounded-full border px-3 py-2 text-xs font-medium transition touch-manipulation sm:min-h-0 sm:py-1.5 ${
            showTags
              ? "border-blue-500/40 bg-blue-500/15 text-blue-100"
              : "border-slate-700/80 bg-slate-950/50 text-slate-300 hover:bg-slate-900/70"
          }`}
        >
          Tags
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
      {showTags ? (
        <div className={`${noteOrder} ${spanFullSm}`}>
          <TagInput handleRef={tagInput} defaultTags={tagSeed} suggestions={tagOptions.names} />
        </div>
      ) : null}
      <button type="submit" className={`${submitOrder} ${spanFullSm} ${primaryBtnClass} py-2.5 sm:py-2`}>
        Add expense
      </button>
    </ServerActionForm>
    </FieldHintModeProvider>
  );
}
