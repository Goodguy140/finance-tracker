"use client";

import { signOutOfDevice } from "@/lib/sign-out";
import {
  DEFAULT_DASHBOARD_READABILITY,
  MAX_VISIBLE_PCT,
  MIN_BUDGET_NAME_VISIBLE_PCT,
  MIN_TEXT_VISIBLE_PCT,
  type DashboardReadability,
} from "@/lib/dashboard-readability";
import { useId, useLayoutEffect, useState } from "react";
import { createPortal } from "react-dom";
import { AccountTypePill } from "@/components/account-type-pill";
import { ServerActionForm } from "@/components/server-action-form";
import { BudgetAlertPreferences } from "@/components/budget-alert-preferences";
import { InstallPrompt } from "@/components/pwa/install-prompt";
import { ACCOUNT_TYPE_LABELS, ACCOUNT_TYPE_ORDER } from "@/lib/account-type-labels";
import { formatCurrency } from "@/lib/money";
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
  hintToggleClass,
  CurrencyAmountInput,
  DateField,
  type Option,
  getTodayIsoDate,
  getProfileInitials,
  defaultExpenseAccountSelectValue,
  getCurrentPeriodMonth,
  getPreviousPeriodMonth,
  formatBudgetPeriodLabel,
} from "./shared";
import {
  changePasswordAction, clearUserFinancialDataAction, createFinancialAccountAction, createInvestmentFlowAction,
  createPortfolioSnapshotAction, createRecurringTransactionAction, deleteBudgetAction, deleteFinancialAccountAction,
  updateDefaultExpenseAccountAction, updateFinancialAccountAction, setFinancialAccountArchivedAction, deleteAccountAction,
  importUserBackupAction, updateBudgetAction, updateDashboardReadabilityAction, updateProfileAction, upsertBudgetAction,
} from "@/app/actions";
import { ExpenseCsvImportForm } from "./expense-forms";
import { SubscriptionsPanel, type SubscriptionView } from "@/components/subscriptions-panel";
import { ApiTokensPanel, type ApiTokenRow, type ApiTokensMfaState } from "@/components/api-tokens-panel";
import { PlaidConnectionsPanel, type PlaidConnectionsPanelProps } from "@/components/plaid-connections-panel";
import { SecurityPanel, type SecurityPanelProps } from "@/components/security-panel";

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
        hintInline
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

      <div className={`${spanFullSm} rounded-xl border border-slate-700/90 bg-slate-950/45 p-3`}>
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

export function RecurringTransactionForm({
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
  const today = getTodayIsoDate();
  const fieldIds = useId();
  const accountSelectDefault = defaultExpenseAccountSelectValue(accounts, defaultExpenseAccountId);
  const [type, setType] = useState<"EXPENSE" | "INCOME">("EXPENSE");
  const categoryOptions = type === "INCOME" ? incomeCategories : expenseCategories;

  return (
    <ServerActionForm action={createRecurringTransactionAction} className={formGridResponsive}>
      <LabeledField label="Recurring transaction name" hint="Shown in your recurring transactions list." className={spanFullSm}>
        <textarea
          name="name"
          rows={2}
          maxLength={80}
          className={textAreaClass}
          placeholder="e.g. Paycheque, rent, gym membership"
        />
      </LabeledField>
      <LabeledField label="Type" hint="Whether this repeats as income or an expense.">
        <select
          id={`${fieldIds}-type`}
          name="type"
          className={selectClass}
          value={type}
          onChange={(event) => setType(event.target.value as "EXPENSE" | "INCOME")}
        >
          <option value="EXPENSE">Expense</option>
          <option value="INCOME">Income</option>
        </select>
      </LabeledField>
      <LabeledField label="Account" hint="Account for this recurring transaction.">
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
      <LabeledField label="Category" hint={type === "INCOME" ? "Income category for this deposit." : "Expense category for budgeting."}>
        <select id={`${fieldIds}-category`} name="categoryId" className={selectClass}>
          {categoryOptions.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </LabeledField>
      <CurrencyAmountInput name="amount" label="Amount each time" placeholder="0.00" />
      <LabeledField label="Cadence" hint="How often this transaction is expected.">
        <select id={`${fieldIds}-cadence`} name="cadence" className={selectClass}>
          <option value="WEEKLY">Weekly</option>
          <option value="BIWEEKLY">Biweekly</option>
          <option value="MONTHLY">Monthly</option>
          <option value="QUARTERLY">Quarterly</option>
          <option value="YEARLY">Yearly</option>
          <option value="BIENNIAL">Every 2 years</option>
        </select>
      </LabeledField>
      <DateField
        name="nextExpectedDate"
        label="Next expected date"
        hint="The next date you expect this transaction."
        defaultValue={today}
      />
      <DateField name="endDate" label="End date" hint="Optional final expected date." />
      <LabeledField label="Posting" hint="Automatic rules are posted to your log as soon as they are due.">
        <select name="postMode" defaultValue="REVIEW" className={selectClass}>
          <option value="REVIEW">Post by hand when due</option>
          <option value="AUTO">Post automatically when due</option>
        </select>
      </LabeledField>
      <LabeledField label="Note" hint="Optional note copied to posted transactions." className={spanFullSm}>
        <textarea name="note" rows={2} maxLength={250} className={textAreaClass} placeholder="Optional details" />
      </LabeledField>
      <button type="submit" className={`${spanFullSm} ${primaryBtnClass} py-2.5 sm:py-2`}>
        Add recurring transaction
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

type SettingsTabId = "profile" | "security" | "accounts" | "budgets" | "subscriptions" | "advanced";

/** A nested card's own explanation, folded behind the same "?" the fields use. */
function CardHeading({ title, hint }: { title: string; hint: string }) {
  const [open, setOpen] = useState(false);
  const hintId = useId();
  return (
    <div className="mb-2">
      <div className="flex items-center gap-1.5">
        <h4 className="text-sm font-medium text-slate-200">{title}</h4>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls={hintId}
          aria-label={`About ${title}: ${hint}`}
          title={hint}
          className={hintToggleClass}
        >
          ?
        </button>
      </div>
      {open ? (
        <p id={hintId} className="mt-1 max-w-prose text-xs leading-relaxed text-slate-500">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/** Row-level edit affordance: the whole row is the button, this just says so without a caption. */
function EditPencil() {
  return (
    <span
      aria-hidden
      className="shrink-0 text-slate-600 transition group-hover:text-slate-300 group-focus-visible:text-slate-300"
    >
      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M16.86 4.49a2.1 2.1 0 112.97 2.97L8.5 18.79l-3.96.99.99-3.96L16.86 4.49z" />
      </svg>
    </span>
  );
}

const SETTINGS_TAB_META: { id: SettingsTabId; label: string; labelCompact: string; hint: string }[] = [
  {
    id: "profile",
    label: "Profile",
    labelCompact: "Profile",
    hint: "Your name, region, and timezone",
  },
  {
    id: "security",
    label: "Security",
    labelCompact: "Security",
    hint: "Password, passkeys, recovery codes, and linked sign-ins",
  },
  {
    id: "accounts",
    // Accounts, the banks that feed them, and CSV import all answer the same question —
    // where transactions come from — so they belong on one page. Mapping a bank account
    // to one of yours is impossible to do sensibly from a different tab.
    label: "Accounts",
    labelCompact: "Accounts",
    hint: "Your accounts, connected banks, and CSV import",
  },
  {
    id: "budgets",
    label: "Budgets",
    labelCompact: "Budgets",
    hint: "Monthly limits by expense category",
  },
  {
    id: "subscriptions",
    label: "Subscriptions",
    labelCompact: "Subs",
    hint: "Shared subscriptions and who has paid",
  },
  {
    id: "advanced",
    label: "Advanced",
    labelCompact: "Advanced",
    hint: "API tokens, backup and restore, and account deletion",
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
  subscriptions,
  defaultExpenseAccountId,
  budgetAlertEmailConfigured,
  budgetAlertEmailEnabled,
  dashboardReadability,
  apiTokens,
  security,
  plaid,
}: {
  defaults: { displayName: string; countryCode: string; timezone: string };
  profileEmail: string;
  hasPassword: boolean;
  joinedAt: string;
  accounts: Option[];
  accountItems: Array<{ id: string; name: string; type: string; archived: boolean; currency: string }>;
  expenseCategories: Option[];
  budgets: Array<{ id: string; periodMonth: string; name: string | null; categoryName: string; limitCents: number }>;
  subscriptions: SubscriptionView[];
  defaultExpenseAccountId: string | null;
  budgetAlertEmailConfigured: boolean;
  budgetAlertEmailEnabled: boolean;
  dashboardReadability: DashboardReadability;
  apiTokens: ApiTokenRow[];
  security: SecurityPanelProps;
  plaid: PlaidConnectionsPanelProps;
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
      // Old anchors are kept pointing at wherever their section now lives, so existing
      // links and bookmarks do not quietly land on the wrong page.
      if (h === "#budgets") setTab("budgets");
      else if (h === "#subscriptions" || h === "#subs") setTab("subscriptions");
      else if (h === "#accounts" || h === "#data" || h === "#import") setTab("accounts");
      else if (h === "#banks" || h === "#plaid") setTab("accounts");
      else if (h === "#integrations" || h === "#api" || h === "#tokens") setTab("advanced");
      else if (h === "#advanced") setTab("advanced");
      else if (h === "#security") setTab("security");
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
    <div className="flex flex-col gap-4">
      <nav
        className="sticky top-0 z-20 border-b border-slate-800/80 bg-slate-950/95 pb-1.5 pt-2 backdrop-blur supports-[backdrop-filter]:bg-slate-950/80"
        aria-label="Settings sections"
      >
        <div>
          <div
            role="tablist"
            className="flex flex-row flex-wrap gap-1.5 pb-1 sm:gap-2"
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
                  className={`touch-manipulation rounded-xl border px-3 py-2 text-center text-[13px] font-medium transition sm:px-4 sm:py-2.5 sm:text-sm ${
                    selected
                      ? "border-slate-600 bg-slate-800 text-slate-50 shadow-sm ring-1 ring-slate-700/80"
                      : "border-transparent bg-slate-950/50 text-slate-400 hover:border-slate-700 hover:bg-slate-900/90 hover:text-slate-200"
                  } shrink-0 whitespace-nowrap`}
                  onClick={() => setTab(t.id)}
                >
                  <span className="lg:hidden">{t.labelCompact}</span>
                  <span className="hidden lg:inline">{t.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      </nav>

      <FieldHintModeProvider mode="info">
      <div className="min-w-0 space-y-4">
        {tab === "profile" ? (
          <div className="space-y-4" role="tabpanel" aria-label="Profile">
            <header className="space-y-1.5 border-b border-slate-800/80 pb-3">
              <h2 className="text-xl font-semibold tracking-tight text-slate-50 sm:text-2xl">Profile</h2>
              <p className="max-w-prose text-sm leading-relaxed text-slate-400">
                How you appear in the app, and the regional defaults applied to new accounts. Sign-in and passkeys
                live under Security.
              </p>
            </header>

            <div className="flex flex-col gap-4 rounded-2xl border border-slate-700/80 bg-gradient-to-br from-slate-800/50 via-slate-900/80 to-slate-950 p-4 shadow-lg ring-1 ring-white/5 sm:flex-row sm:items-center sm:gap-6">
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

            <section className="space-y-4 rounded-2xl border border-slate-800 bg-gradient-to-b from-slate-900/90 to-slate-950/80 p-4 shadow-lg sm:p-5">
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
                  hintInline
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
                  hintInline
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

            <section className="space-y-4 rounded-2xl border border-slate-800 bg-gradient-to-b from-slate-900/90 to-slate-950/80 p-4 shadow-lg sm:p-5">
              <div className="space-y-1 border-b border-slate-800/90 pb-4">
                <h3 className="text-base font-semibold text-slate-100">Dashboard</h3>
                <p className="max-w-prose text-sm text-slate-400">
                  When the window is too narrow for your cards to show their text, the dashboard merges a column
                  away to give the rest more room. Lower these to keep more columns at the cost of more cut-off
                  text; raise them to merge sooner.
                </p>
              </div>

              <ServerActionForm action={updateDashboardReadabilityAction} className={`${formGridResponsive} gap-4 sm:gap-4`}>
                <LabeledField
                  label="Card text visible (%)"
                  hint={`How much of each card's text must show in full. ${MIN_TEXT_VISIBLE_PCT}–${MAX_VISIBLE_PCT}; default ${DEFAULT_DASHBOARD_READABILITY.textVisiblePct}.`}
                  hintInline
                >
                  <input
                    name="textVisiblePct"
                    type="number"
                    min={MIN_TEXT_VISIBLE_PCT}
                    max={MAX_VISIBLE_PCT}
                    step={1}
                    required
                    defaultValue={dashboardReadability.textVisiblePct}
                    className={inputClass}
                  />
                </LabeledField>
                <LabeledField
                  label="Budget names visible (%)"
                  hint={`How much of each budget's name must show, name by name. ${MIN_BUDGET_NAME_VISIBLE_PCT}–${MAX_VISIBLE_PCT}; default ${DEFAULT_DASHBOARD_READABILITY.budgetNameVisiblePct}.`}
                  hintInline
                >
                  <input
                    name="budgetNameVisiblePct"
                    type="number"
                    min={MIN_BUDGET_NAME_VISIBLE_PCT}
                    max={MAX_VISIBLE_PCT}
                    step={1}
                    required
                    defaultValue={dashboardReadability.budgetNameVisiblePct}
                    className={inputClass}
                  />
                </LabeledField>
                <div className={`${spanFullSm} flex flex-wrap gap-2 pt-1`}>
                  <button type="submit" className={primaryBtnClass}>
                    Save dashboard settings
                  </button>
                </div>
              </ServerActionForm>
            </section>

            <InstallPrompt />
          </div>
        ) : null}

        {tab === "security" ? (
          <div className="space-y-4" role="tabpanel" aria-label="Security">
            <header className="space-y-1.5 border-b border-slate-800/80 pb-3">
              <h2 className="text-xl font-semibold tracking-tight text-slate-50 sm:text-2xl">Security</h2>
              <p className="max-w-prose text-sm leading-relaxed text-slate-400">
                How you sign in, and what protects this account. Passkeys are also what gate connecting a bank or
                minting an API token.
              </p>
            </header>

            <section className="space-y-4 rounded-2xl border border-slate-800 bg-gradient-to-b from-slate-900/90 to-slate-950/80 p-4 shadow-lg sm:p-5">
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
                  Password
                </h3>
                <p className="max-w-prose text-sm text-slate-400">
                  {hasPassword
                    ? "Update the password for your email login. If you also use Google, both methods stay linked to this account."
                    : "Your account does not use a saved password (for example, you may sign in only with Google)."}
                </p>
              </div>

              {hasPassword ? (
                <ServerActionForm
                  action={changePasswordAction}
                  className="space-y-4"
                  // The change revokes every session, this one included; a clean sign-out
                  // beats letting the next navigation discover the dead cookie.
                  onSuccess={() => void signOutOfDevice()}
                >
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

            <SecurityPanel {...security} />
          </div>
        ) : null}

        {tab === "accounts" ? (
          <div className="space-y-4" role="tabpanel" aria-label="Accounts">
            <header className="space-y-1.5 border-b border-slate-800/80 pb-3">
              <h2 className="text-xl font-semibold tracking-tight text-slate-50 sm:text-2xl">Accounts</h2>
              <p className="max-w-prose text-sm leading-relaxed text-slate-400">
                The accounts your expenses, income and recurring transactions are recorded against — plus the two
                ways transactions get in: a connected bank, or a CSV statement.
              </p>
            </header>
            <div className="space-y-4 rounded-2xl border border-slate-800 bg-gradient-to-b from-slate-900/85 to-slate-900/55 p-3.5 shadow-lg lg:space-y-5 lg:p-4">
              <div className="min-w-0 space-y-1 border-b border-slate-800/80 pb-3">
                <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
                  <h3 className="text-lg font-semibold tracking-tight text-slate-100 lg:text-xl">Your accounts</h3>
                  <p className="text-xs tabular-nums text-slate-500">
                    {activeAccountCount} active
                    {archivedAccountCount > 0 ? ` · ${archivedAccountCount} archived` : ""}
                  </p>
                </div>
                <p className="max-w-prose text-sm leading-relaxed text-slate-400">
                  Accounts back expenses, income, recurring transactions, and CSV imports. Active accounts appear in dashboard
                  pickers; archived ones stay out of the way until you restore them.
                </p>
              </div>

              <div className="rounded-xl border border-slate-800/90 bg-slate-950/35 p-3 lg:p-3.5">
                <CardHeading
                  title="Default expense account"
                  hint="Preselects this account on the dashboard Add Expense form and in CSV import defaults. Choose None to use your first active account instead."
                />
                <ServerActionForm action={updateDefaultExpenseAccountAction} className={`${formGridResponsive} items-end`}>
                  <LabeledField
                    label="Account"
                    hint="Only active accounts are listed. Archiving or removing an account clears this default."
                    hintInline
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

              <div className="rounded-xl border border-slate-800/90 bg-slate-950/35 p-3 lg:p-3.5">
                <CardHeading
                  title="Add a new account"
                  hint="Choose a clear name and the account category that fits best."
                />
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
                  <p className="rounded-xl border border-dashed border-slate-700 bg-slate-950/40 px-3 py-5 text-center text-sm text-slate-500">
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
                          aria-label={`Edit ${account.name}`}
                          className="group flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition hover:bg-slate-900/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 sm:px-3.5"
                        >
                          <div className="min-w-0 flex-1 space-y-1.5">
                            <p className="truncate text-base font-semibold text-slate-100">{account.name}</p>
                            <div className="flex flex-wrap items-center gap-2">
                              <AccountTypePill accountType={account.type} />
                              <span className="rounded-md border border-slate-700/80 bg-slate-900/60 px-2 py-0.5 text-[11px] font-medium tabular-nums text-slate-400">
                                {account.currency}
                              </span>
                            </div>
                          </div>
                          <EditPencil />
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
                            aria-label={`Edit ${account.name}`}
                            className="group flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition hover:bg-slate-900/30 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 sm:px-3.5"
                          >
                            <div className="min-w-0 flex-1 space-y-1.5">
                              <p className="truncate text-base font-semibold text-slate-200">{account.name}</p>
                              <div className="flex flex-wrap items-center gap-2">
                                <AccountTypePill accountType={account.type} />
                                <span className="rounded-md border border-slate-600/80 bg-slate-900/50 px-2 py-0.5 text-[11px] font-medium tabular-nums text-slate-500">
                                  {account.currency}
                                </span>
                                <span className="rounded-full border border-slate-600 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-500">
                                  Hidden
                                </span>
                              </div>
                            </div>
                            <EditPencil />
                          </button>
                        </li>
                      ))}
                  </ul>

                </div>
              ) : null}
            </div>

            {/* Below the accounts themselves. Both of these feed those accounts, so they read
                as "and here is how transactions get into them" — rather than greeting someone
                with a wall of bank UI before they have seen what they own. */}
            <PlaidConnectionsPanel {...plaid} />

            <ExpenseCsvImportForm
              accounts={accounts}
              expenseCategories={expenseCategories}
              defaultExpenseAccountId={defaultExpenseAccountId}
            />

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

        {tab === "subscriptions" ? (
          <div
            id="subscriptions"
            className="scroll-mt-24 space-y-4"
            role="tabpanel"
            aria-label="Subscriptions"
          >
            <header className="space-y-1.5 border-b border-slate-800/80 pb-3">
              <h2 className="text-xl font-semibold tracking-tight text-slate-50 sm:text-2xl">Subscriptions</h2>
              <p className="max-w-prose text-sm leading-relaxed text-slate-400">
                Add and edit your recurring subscriptions, split them with other people, and track who has been sent the
                bill and who has paid. When you mark someone paid, their share is credited to that subscription&rsquo;s
                expense in your log. Post or skip each charge from the dashboard.
              </p>
            </header>
            <SubscriptionsPanel
              subscriptions={subscriptions}
              accounts={accounts}
              expenseCategories={expenseCategories}
              defaultExpenseAccountId={defaultExpenseAccountId}
            />
          </div>
        ) : null}

        {tab === "budgets" ? (
          <div
            id="budgets"
            className="budget-settings-card scroll-mt-24 space-y-5"
            role="tabpanel"
            aria-label="Budgets"
          >
            <header className="space-y-1.5 border-b border-slate-800/80 pb-3">
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

            <BudgetAlertPreferences emailConfigured={budgetAlertEmailConfigured} emailEnabled={budgetAlertEmailEnabled} />

            <section className="space-y-4 rounded-2xl border border-slate-800 bg-gradient-to-b from-slate-900/90 to-slate-950/80 p-4 shadow-lg sm:p-5">
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
                <div className="rounded-2xl border border-dashed border-slate-700 bg-slate-950/35 px-4 py-7 text-center">
                  <p className="text-sm font-medium text-slate-300">No budgets yet</p>
                  <p className="mx-auto mt-2 max-w-md text-sm text-slate-500">
                    Create your first cap above. Pick a category you already use for expenses, or type a new name to track a
                    new bucket.
                  </p>
                </div>
              ) : (
                <ul className="space-y-2">
                  {budgets.map((budget) => {
                    const periodLabel = formatBudgetPeriodLabel(budget.periodMonth);
                    const displayName = budget.name ?? budget.categoryName;
                    return (
                      <li
                        key={budget.id}
                        className="overflow-hidden rounded-2xl border border-slate-800 bg-gradient-to-b from-slate-900/80 to-slate-950/70 shadow-md ring-1 ring-white/5"
                      >
                        {/* Collapsed by default: every row carried a full edit form, so a
                            handful of budgets turned this tab into a wall of inputs. */}
                        <details className="group">
                          <summary className="flex cursor-pointer list-none items-center gap-3 px-3.5 py-2.5 transition hover:bg-slate-900/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500/40 sm:px-4 [&::-webkit-details-marker]:hidden">
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm font-semibold text-slate-50">
                                {budget.categoryName}
                              </span>
                              <span className="mt-0.5 block truncate text-xs tabular-nums text-slate-500">
                                {periodLabel}
                              </span>
                            </span>
                            <span className="shrink-0 text-sm font-semibold tabular-nums text-emerald-300/95">
                              {formatCurrency(budget.limitCents)}
                            </span>
                            <span aria-hidden className="shrink-0 text-slate-500 transition group-open:rotate-90">
                              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                              </svg>
                            </span>
                          </summary>

                          <div className="border-t border-slate-800/80 px-3.5 pb-3.5 pt-3 sm:px-4">
                        <p className="mb-3 text-xs text-slate-500">
                          Period code <span className="font-mono text-slate-400">{budget.periodMonth}</span>
                        </p>

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

                        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-slate-800/80 pt-3">
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
                          </div>
                        </details>
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
            <header className="space-y-1.5 border-b border-slate-800/80 pb-3">
              <h2 className="text-xl font-semibold tracking-tight text-slate-50 sm:text-2xl">Advanced</h2>
              <p className="max-w-prose text-sm leading-relaxed text-slate-400">
                Connect external apps, back up or restore this account, clear your financial data, or permanently
                delete your login. These affect your whole account, so review each one carefully.
              </p>
            </header>

            <ApiTokensPanel
              tokens={apiTokens}
              mfa={
                {
                  enrolled: security.passkeys.length > 0,
                  freshUntil: security.freshUntil,
                } satisfies ApiTokensMfaState
              }
            />
            <section className="space-y-3 rounded-2xl border border-sky-800/60 bg-sky-950/25 p-3.5 lg:p-4">
              <h3 className="text-base font-semibold text-sky-200 lg:text-lg">Backup and restore</h3>
              <p className="text-sm text-sky-100/85">
                Export all data associated with this user account to a JSON file, then import it later to restore this
                account. Import replaces this account&apos;s existing data, and disconnects any linked banks — backups
                do not include bank connections, so reconnect them afterwards.
              </p>
              <a
                href="/api/backup/export/me"
                className="inline-flex items-center justify-center rounded-xl bg-sky-700 px-3 py-2 text-sm font-medium text-white transition hover:bg-sky-600"
              >
                Export backup JSON
              </a>
              <ServerActionForm action={importUserBackupAction} className="space-y-2 rounded-xl border border-sky-800/70 bg-sky-950/35 p-2.5">
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
            {/* Two irreversible actions sat in the same scroll as API tokens and backup.
                They keep their own section, shut by default, so neither is one stray
                click from a routine task. */}
            <details className="group rounded-2xl border border-red-900/50 bg-red-950/15">
              <summary className="flex cursor-pointer list-none items-center gap-3 rounded-2xl px-3.5 py-3 transition hover:bg-red-950/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-red-500/40 lg:px-4 [&::-webkit-details-marker]:hidden">
                <span className="min-w-0 flex-1">
                  <span className="block text-base font-semibold text-red-300 lg:text-lg">Danger zone</span>
                  <span className="mt-0.5 block text-sm text-red-200/70">
                    Clear your financial data, or delete this login. Neither can be undone.
                  </span>
                </span>
                <span aria-hidden className="shrink-0 text-red-400/70 transition group-open:rotate-90">
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                  </svg>
                </span>
              </summary>
              <div className="space-y-3 border-t border-red-900/40 p-3.5 lg:p-4">
                <ServerActionForm action={clearUserFinancialDataAction} className="space-y-2 rounded-2xl border border-amber-800/60 bg-amber-950/25 p-3.5 lg:p-4">
                  <h3 className="text-base font-semibold text-amber-200 lg:text-lg">Clear financial data</h3>
                  <p className="text-sm text-amber-100/85">
                    Permanently removes transactions (including splits), budgets, financial accounts, categories,
                    recurring transactions, investment flows, and portfolio snapshots for your login. Your email, password, OAuth
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
                <ServerActionForm action={deleteAccountAction} className="space-y-2 rounded-2xl border border-red-900/60 bg-red-950/30 p-3.5 lg:p-4">
                  <h3 className="text-base font-semibold text-red-300 lg:text-lg">Delete account</h3>
                  <p className="text-sm text-red-200/80">Type DELETE to confirm irreversible account removal.</p>
                  <input name="confirmation" className={inputClass} />
                  <button className="rounded-xl bg-red-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-red-500">
                    Delete account
                  </button>
                </ServerActionForm>
              </div>
            </details>
          </div>
        ) : null}
      </div>
      </FieldHintModeProvider>
    </div>
  );
}

