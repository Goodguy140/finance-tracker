# Feature map

Every user-facing feature, grouped by where it appears in the app, with the route and the main
files behind it. Server actions live in `src/app/actions/<area>.ts`; e2e specs in
`tests/e2e/<feature>.spec.ts`. When you add, move or remove a feature, update this file in the
same PR.

## App shell

- **Navigation** (Dashboard, Insights, Reports, Settings; top bar on desktop, tab bar on phones;
  account menu; `?tag=` carried to Insights/Reports): `src/components/app-nav.tsx`
- **Master search** (button in the top bar on every signed-in page, Ctrl/⌘ K, or "/"; a full
  screen on phones): finds pages, every settings section and the things inside them (passkeys,
  budgets, contribution room…), admin pages for admins, and actions (add expense / income /
  transfer / recurring rule, sync banks, import, backup, print, log out); and the user's own
  data from every month: transactions by title, note, bank description or amount, transfers,
  accounts, categories, tags, rules, recurring rules, savings goals.
  `src/components/command-palette.tsx`, fixed entries `src/lib/search/commands.ts`, data
  `src/lib/search/search-data.ts` behind `GET /api/search`. A found transaction or recurring
  rule opens on the dashboard at its month (`?open=<id>`, read by the expense, income and
  transfer logs and the Recurring card); an add opens the Add card on desktop or the quick-add
  sheet on phones (`?add=<kind>`, `src/lib/search/dashboard-requests.ts`)
- **Search all transactions** (`/search`): every match across months, grouped by month, with
  type / account / category / tag filters and spent/received totals; where an account,
  category or tag found by the master search lists its transactions. `src/app/search/page.tsx`
- **Not-found and error pages** in the app's dark style: `src/app/not-found.tsx`, `src/app/error.tsx`,
  `src/components/status-page.tsx`
- **Installable web app**: `src/app/manifest.ts`, `src/components/pwa/*` (install prompt, offline
  banner, private-cache purge on sign-out, service worker), `/offline`
- **Local notifications** for budget alerts: `src/lib/pwa-notifications.ts`

## Dashboard (`/`)

Page: `src/app/page.tsx`. Grid and layout: `src/components/dashboard-grid.tsx`,
`dashboard-edit-toolbar.tsx`, `dashboard-column-resizer.tsx`, `src/lib/dashboard-layout/*`.
Card registry is `DASHBOARD_CARDS` in `src/lib/dashboard-layout/cards.ts`; per-card settings are
`cardSettingsSchema` in `schema.ts` and the forms in
`src/components/dashboard-cards/card-settings-forms.tsx`. Layout is saved as JSON on the user
(`actions/dashboard-layout.ts`), so card settings need no migration.

- **Period filter** (month / YTD / lifetime / custom range, prev/next, quick period):
  `dashboard-month-filter.tsx`, `src/lib/dashboard-period.ts`. Custom is `?range=custom&from=&to=`
  (both days included, `src/lib/date-range.ts`); budgets sum the months it touches, the
  cumulative chart goes by day up to 62 days and by month past that
- **Tag filter** (`?tag=`): `src/lib/tags.ts` (`resolveTagFilter`)
- **Budget alerts bell** (warnings, over-budget pace, month-over-month trends, dismiss):
  `budget-alerts-panel.tsx`, `src/lib/budget-alerts.ts`
- **Refresh banks** button in the Expense Log header (banks not checked in 15 min):
  `refresh-linked-accounts.tsx`, `src/lib/plaid/log-refresh.ts`
- **Layout editing**: move cards, resize columns (24-unit grid, max 4 columns), stack cards as
  tabs (`card-stack.tsx`), remove/add back, reset
- **Phone quick-add** (expense, income, transfer): `dashboard-mobile-actions.tsx`
- **Get started** checklist above the cards for a new user (connect a bank when Plaid is set up,
  import or log transactions, set a budget, add a recurring bill, record balances). Each step
  ticks off from the user's own data; the card goes when all are done or on Hide
  (`User.getStartedDismissedAt`): `get-started-card.tsx`, `src/lib/get-started.ts`

Cards (`src/components/dashboard-cards/`), with their gear settings:

| Card (id) | Features | Settings |
| --- | --- | --- |
| Add (`add-expense`) `add-entry-card.tsx` | Expense / Income / Transfer switch, title autocomplete (`expense-title-autocomplete.tsx`), rules applied while typing (`transaction-rules-context.tsx`) | posted date, note, receipt breakdown |
| Expense Log (`expense-log`) `src/components/expense-log.tsx` | search, tag filter, **Needs review** filter for rows nobody typed in (CSV/OFX imports, recurring auto-posts, API posts; `Transaction.needsReview`; "Mark N shown as reviewed", bulk "Mark reviewed", saving the edit dialog clears it; count on the monthly review), day groups, verified badge, edit dialog (dates, note, tags, splits, credits, owed shares, receipts: photos or PDFs kept in `TransactionAttachment`, type read from the bytes, served by `/api/attachments/[id]`; `receipts-section.tsx`, `src/lib/attachments.ts`; kept through Undo; not in JSON backups), **Select** mode for bulk changes (`expense-bulk-bar.tsx`, `bulkEditExpensesAction`: set category, set account, add tag, delete with one Undo; split expenses keep their categories), delete with an Undo toast (`undo-toast.tsx`, `src/lib/transaction-undo.ts`, kept 15 minutes in `DeletedTransaction`); Owed to you (`owed-to-you.tsx`); Transfers list (`transfer-log.tsx`: mark/unmark, pair/unpair, set account); bank review queue | density, list height, show review queue |
| Income (`income`, conditional) `income-card.tsx`, `income-log.tsx` | list, edit, delete (with Undo); absent from a period with no income | density, list height |
| Budgets (`budgets`) `budgets-card.tsx` | progress per category with "$X left" / "$X over" on each row and the total, days left in the current month, rollover (`src/lib/budget-rollover.ts`), reallocate (`budget-reallocate-dialog.tsx`), rows under category group headings with group totals, yearly budgets as sinking funds | per row, hide zero spend, period note |
| Spending by category (`spending-by-category`) `spending-by-category-card.tsx`, `category-spend-pie.tsx` | pie with colors shared with the log (`src/lib/category-colors.ts`), optional savings slice (`src/lib/savings-transfers.ts`) | chart height, slices shown, show savings, add up category groups |
| Cumulative spending (`cumulative-spend`) `cumulative-spend-card.tsx`, `src/lib/cumulative-spend.ts` | running total, expected line, compare with last month / 3-month avg | chart height, expected line, compare with |
| Recurring (`recurring`) `recurring-card.tsx`, `recurring-transactions-panel.tsx`, `recurring-rule-form.tsx` | rules due in the month as one summary line each (category · account · cadence · date), overdue carry ("Unposted since"), Post, with Skip/Edit/Disable/Remove behind the "⋯" button, auto-post, new/edit/pause/delete, recurring transfers (from/to account, `RecurringTransaction.transferAccountId`, kept out of income and bills), cash-flow summary; `src/lib/recurring-transactions.ts`, `recurring-post.ts` | cash-flow summary, rules shown |
| Insights (`insights`) `insights-card.tsx` | count per section and the most pressing few, link to `/insights`; leaves out budget and money-owed insights, which this page already shows | insights shown |
| Upcoming bills (`bills-forecast`) `bills-forecast-card.tsx`, `src/lib/bills-forecast.ts` | bills and income due by day, running net | days ahead (30/60/90) |
| Safe to spend (`safe-to-spend`, tab beside Budgets) `safe-to-spend-card.tsx`, `src/lib/safe-to-spend.ts`, `safe-to-spend-data.ts` | what is free to spend until month end, always for the month now running: income received − spent + recurring income still due − recurring bills still due (outside budgeted categories) − what is left in budgets (with rollover) − savings goals' monthly need; a-day figure for the days left; also a line in the email digest | show breakdown |
| Calendar (`calendar`, tab on Cumulative spending) `calendar-card.tsx`, `src/lib/spending-calendar.ts` | the month on screen as a Sunday-first grid: each day's spending and income, dots for recurring bills and pay still due (red when unposted), busiest day outlined; a day opens the dashboard on that one day (`?range=custom&from=&to=`); asks for a single month otherwise | show recurring due |
| Investments (`investments`, tab on Insights) `investments-card.tsx` | contributions/withdrawals, count a transfer toward room, portfolio snapshots, room left (`src/lib/contribution-room.ts`); `actions/investments.ts` | room left, add forms, recent activity |

## Bank sync (Plaid)

Code: `src/lib/plaid/*`, `actions/plaid.ts`. Read the Plaid section of `AGENTS.md` first.

- **Connect / map accounts / re-sign-in / unlink** (`/settings/banks`):
  `plaid-connections-panel.tsx`, `plaid-link-button.tsx`, `src/lib/plaid/connections.ts`,
  `mapping.ts`, `unlink.ts`, `item-state.ts`, `attention.ts`. Mapping an account after the
  first sync brings in its earlier history on the next sync (`setPlaidAccountMapping`)
- **Sync** (one entry point `syncBank` in `sync-bank.ts`; `sync.ts`, `sync-store.ts`,
  `ingest.ts`), background sweep (`src/lib/plaid-sync-scheduler.ts`), webhooks
  (`src/app/api/plaid/webhook/route.ts`, `webhooks.ts`, `webhook-verify.ts`), consent withdrawn
  purge (`purge.ts`)
- **Review queue** in the Expense Log: `plaid-review-queue.tsx`, `src/lib/plaid/review.ts`,
  `review-queue-page.ts`. Add, link to existing (verify), add as new, hide, add all, tick rows to add,
  ignore or add in one category (`ReviewBulkBar`), link all strong matches, pair as
  transfer (`transfer-pairing.ts`), revised rows apply/dismiss, auto-link exact matches
  (`matcher.ts`), rule proposals per row (`staged-rules.ts`)
- **Bank category mapping**: `category-map.ts`, `category-mapping-view.ts`, in Settings →
  Categories

## Insights (`/insights`)

Page: `src/app/insights/page.tsx`. Engine: `src/lib/insights/*` (`load.ts` loads, `index.ts`
builds and orders the sections, `facts.ts` works out each transaction's merchant, habit,
delivery, fee, streaming service and category role once for every detector). Sections, in
order: Coming up, Possible gaps, Recurring, Habits, Ways to save, Suggestions, Going well. Under
a `?tag=` filter only what is worked out from transactions shows (no score, balances, budgets,
owed money, room, goals or gaps).

- **Financial score** (savings rate, emergency fund, fixed bills, budgets kept, spending trend,
  months in the black; a "possible gaps in your data could change this" line linking to Possible
  gaps, here and on Reports; accounts in another currency it leaves out, named under "How this is
  worked out"): `financial-score-card.tsx`, `src/lib/financial-score.ts`,
  `financial-score-data.ts`
- **Savings goals card** (progress, what a dated goal needs a month, and an estimated completion
  date with or without a target date: from the linked balance's growth, or from net transfers
  into the account when the balance has too few readings): `savings-goals-card.tsx`,
  `savings-goal-progress.tsx`, `src/lib/savings-goals.ts`, `savings-goals-data.ts`
- **Coming up** (an account the recurring bills take below zero, from `projectBalances` and a
  balance read in the last month; a budget over, on pace to go over or nearly used this month,
  left off the dashboard card, which has the budget alerts panel; a yearly charge due within 30
  days; pay that is late or came in short, `changes.ts`; RRSP room left in the first 60 days of
  the year and FHSA room that will not carry over, Canada only, `standing.ts`): `ahead.ts`
- **Possible gaps in your data** (pay, savings transfers, card payments and other transfers that
  skipped an occurrence, or are past due, leaving pay that is late right now to Coming up; recent
  months with no income for someone who usually has some; an account used about weekly that went
  quiet for three weeks or more): `gaps.ts`; what would move the financial score (an emergency-fund
  balance older than the account's latest entries, or none; bills noticed but not set up as
  recurring; card payments and moves between accounts booked as spending or income; transfers
  that name no destination, or keep going into an account not marked "Counts as savings"):
  `score-gaps.ts`
- **Recurring charges we noticed** (track as recurring): `recurring-detection.ts`; a new
  streaming subscription or a trial turned paid, and a recurring entry with no charge for 1.5
  cycles: `changes.ts`
- **Spending habits** (track separately, on/off): `habits.ts`, `habit-patterns.ts`
- **Ways to save** (price increase, streaming overlap, double charge, frequent purchases,
  delivery apps, eating-out share, bank fees; a scheduled bill far above its usual,
  `changes.ts`; cash beyond six months of spending, `standing.ts`; the "could save about $X a year" line adds up each idea's `savingCents`,
  counting shared money once): `savings.ts`
- **Suggestions** (the financial score's weakest factors, `score.ts`, listed here instead of on
  the score card, which keeps them on Reports and under a tag filter; spending ahead of income
  and savings rate only under a tag, where there is no score (by transfers into "Counts as
  savings" accounts once any is marked, as the score does); category up last month, no budget,
  catch-all category, untitled): `improvements.ts`; money owed back for over a month (left off
  the dashboard card, which has the Expense Log's "Owed to you"), a savings goal behind:
  `standing.ts`
- **Going well** (a category well down on its usual, every scored month in the black, every
  budget kept): `standing.ts`
- **Dismiss / snooze / restore, tag filter** (a dismissed insight shows again once it is half as
  big again as when dismissed, `InsightDismissal.dismissedCents`): `actions/insights.ts`,
  `src/components/insights/insight-item.tsx`

## Reports (`/reports`)

Page: `src/app/reports/page.tsx`; data `src/lib/reports/*`; charts
`src/components/reports/report-charts.tsx`.

- Period picker (last 12 months, years, or a custom range: a plain GET form sending `from`/`to`,
  carried in links as `period=from_to`), tag filter, totals (income, spending, left over, saved), "Download
  CSV" of the period's transactions
- Financial score as one line linking to Insights (`FinancialScoreChip`), **net worth** (`src/lib/net-worth.ts`), **projected balances**
  (`src/lib/projected-balances.ts`); "Include recurring transfers" option
  (`projection-transfers-toggle.tsx`, `User.projectionIncludesTransfers`, off by default) moves
  each recurring transfer out of one account and into the other, also in Insights' Coming up and
  the printable summary
- **What if…** under projected balances: try a new recurring bill or income from a date, an
  income change by a percentage from a date, or dropping recurring bills, and see net worth at
  30 / 90 / 180 days and a year against today's plan, with any account that would go below zero.
  Held only in the browser; nothing is saved. `src/components/reports/what-if-panel.tsx`,
  `src/lib/forecast-scenarios.ts` (on `projectBalances`, which takes other horizons via `days`)
- Income vs spending by month from the first month with data (table toggle), cash-flow Sankey, year over
  year (says so instead of zeros when there is no earlier year), payees, and "Who paid you" for income
- **Merchant page** `/reports/merchant`: `src/app/reports/merchant/page.tsx`
- **Year-end summary** `/reports/year` ("Year-end summary" on Reports; last year by default):
  year totals and comparison with the year before, biggest month, top categories and payees;
  totals per tag with tax-looking names (donation, medical, deductible…) first and marked "Tax
  time"; contributions and withdrawals per registered account from the Investments card; Print
  and a CSV for the year. `src/app/reports/year/page.tsx`, `src/lib/reports/year-summary.ts`
- **Monthly review** `/reports/month?month=YYYY-MM` ("Monthly review" on Reports; the month just
  finished by default; linked from the monthly email digest): month totals against the month
  before, categories that moved most, where it went, biggest purchases, budgets kept and missed
  with whether each leftover or overspend rolls into next month, bank rows still waiting for
  review, and "Mark month closed" / Reopen (`MonthClose`, a record only: nothing is locked).
  `src/app/reports/month/page.tsx`, `src/lib/reports/month-recap.ts`, `actions/month-close.ts`,
  `src/components/reports/month-close-button.tsx`
- **Debt payoff** `/reports/debt` (linked from Net worth when there is a card or loan): each
  card's and loan's balance, interest rate and minimum (`Account.interestRateBps`,
  `.minimumPaymentCents`, set on the page), and a plan for a monthly amount comparing highest
  rate first, smallest balance first and minimums only (debt-free month, interest, payoff order):
  `src/app/reports/debt/page.tsx`, `src/lib/debt-payoff.ts`, `actions/debt.ts`
- **Print and templates** `/reports/print`: `printables-panel.tsx`, `src/lib/printables/*`,
  `src/app/api/printables/*`. Financial summary PDF, action plan (3/6/12/24+ months, blank
  version), 10 templates (budget, bills, goals, debt, net worth, subscriptions, sinking funds,
  paycheque, spending log, accounts) filled or blank, PDF or CSV

## Settings (`/settings/*`)

Sections are defined once in `src/lib/settings-sections.ts` (sidebar, home list, search, legacy
`#hash` redirects). Pages: `src/app/settings/<id>/page.tsx`; nav
`src/components/settings/settings-nav.tsx`.

- **You**
  - Profile (name, country, timezone): `settings/you-forms.tsx`, `actions/auth.ts`
  - Security (password, passkeys, recovery codes, linked Google/SSO, sign out everywhere):
    `security-panel.tsx`, `actions/mfa.ts`
  - Notifications (budget alert emails): `budget-alert-preferences.tsx`,
    `src/lib/budget-alert-dispatch.ts`
  - Email digest (off / weekly on Mondays / monthly on the 1st, after 7am local; spent and
    received, top categories, biggest purchases, budgets over 80%, bills coming up, review
    queue count, safe to spend for the month; skipped when empty; "Send me one now"): `email-digest-preferences.tsx`,
    `src/lib/email-digest.ts`, hourly `email-digest-scheduler.ts` (`EMAIL_DIGEST_SCHEDULER`)
  - Bill reminders (off / the day before / 3 days / a week before; one email listing recurring
    bills and transfers coming up, each occurrence reminded once via
    `RecurringTransaction.reminderSentForDate`; same hourly sweep, after 7am local):
    `bill-reminder-preferences.tsx`, `src/lib/bill-reminders.ts`
  - Charge alerts (an email when a bank sync brings in money out at or over an amount, home
    currency only, and/or at least 3× and $25 above the merchant's usual from 3+ earlier
    charges; each staged row looked at once via `ChargeAlertSetting.checkedThrough`; turning
    on starts from now; same hourly sweep, any hour): `charge-alert-preferences.tsx`,
    `src/lib/charge-alerts.ts`
  - Appearance (dashboard readability, install app): `src/lib/dashboard-readability.ts`
- **Money**
  - Accounts (add/edit/archive/delete, default expense account, currency, balances, counts as
    savings, contribution room): `settings/accounts-manager.tsx`, `account-balances-panel.tsx`,
    `contribution-room-panel.tsx`, `actions/accounts.ts`. Currency is fixed once an account has
    transactions, recurring rules, balances or a bank mapping, and a non-home-currency account
    with transactions can only be archived, not deleted (`src/lib/account-currency-guard.ts`)
  - Reconcile with a statement (`/settings/accounts/reconcile`, "Reconcile" on Accounts): dates
    and opening/closing balances in, the log's entries with a running balance and the difference
    out (cards and loans as amounts owed); "Mark reconciled" keeps an `AccountReconciliation` and
    the closing balance as a manual balance unless the bank reported that day:
    `src/lib/reconciliation.ts`, `actions/reconciliation.ts`
  - Savings goals: `settings/savings-goals-panel.tsx`, `actions/savings-goals.ts`
  - Connected banks: see Bank sync
  - Categories & budgets (add, rename, merge, delete with reassign, budget, rollover, earlier
    budgets, bank mapping, group): `categories-panel.tsx`, `settings/budget-history.tsx`,
    `actions/categories.ts`, `actions/budgets.ts`. **Category groups** (`Category.groupName`, a
    shared label, matched ignoring case; `src/lib/category-groups.ts`): the list is shown under
    group headings with each group's budget and spend; the Budgets card shows its rows under
    group headings with the group's total and what is left; the pie adds each group up (card
    setting "Add up category groups", on by default); Reports has "Spending by group". **Yearly
    budgets** (`YearlyBudget`, one row per category and year, the latest on or before the year
    shown applying; `src/lib/yearly-budgets.ts`, "Yearly budget" in a category's settings): shown
    as sinking funds in a "Yearly budgets" section of the Budgets card (spent this year of the
    limit, a twelfth a month, and what the fund holds: set aside so far less spent), kept out of
    the monthly totals and alerts; in backups
  - Rules (title/type/account/amount conditions; set category, title, amount, account, note,
    tag, mark as transfer; priority, enable, preview and apply, learned suggestions):
    `transaction-rules-panel.tsx`, `src/lib/transaction-rules.ts`,
    `transaction-rules-server.ts`
  - Tags (rename, merge, delete): `settings/tags-panel.tsx`, `src/lib/tags*.ts`
  - Subscriptions (shared members, who paid, skip occurrence): `subscriptions-panel.tsx`,
    `actions/subscriptions.ts`
- **Data**
  - Import a CSV, OFX or QFX statement with summary (rows already in the log on the same
    account are skipped). Amount sign either way round, or separate debit and credit columns
    (`statementOutflow`); money coming in is a refund (negative expense) or, if chosen, income
    in a picked category. OFX/QFX is read into the same column table (`src/lib/ofx.ts`):
    `forms/expense-forms.tsx`, `forms/csv-import-summary-dialog.tsx`, `src/lib/csv-import.ts`
  - Backup & export (JSON export, transactions as CSV for all time or a date range
    (`src/lib/transactions-csv.ts`, `src/app/api/export/transactions`), restore up to 20 MB, clear data, delete account):
    `settings/data-forms.tsx`, `src/lib/backup*.ts`, `src/app/api/backup/export/me`
  - Developer (API tokens with chosen scopes; `GET /api/v1/budgets`, `GET`/`POST /api/v1/transactions`,
    `GET /api/v1/accounts`, `GET /api/v1/categories`): `api-tokens-panel.tsx`, `src/lib/api-token.ts`,
    `src/lib/api-v1/*`, `src/app/api/v1/*`

## Admin (`/settings/admin/*`, admins only)

Nav `src/components/admin/admin-nav.tsx`; actions `actions/admin*.ts`.

- Overview (attention items): `src/lib/admin-attention.ts`
- Analytics: `admin-analytics-panel.tsx`, `src/lib/admin-analytics*.ts`
- Users (role, disable, force sign-out, delete): `admin-user-table.tsx`, `src/lib/admin-users.ts`
- Authentication (password login, public sign-up, Google/SSO): `forms/admin-forms.tsx`,
  `src/lib/auth-settings.ts`, `oauth-settings.ts`, `signup-policy.ts`
- Integrations (Plaid credentials, all bank connections): `src/lib/admin-plaid-overview.ts`
- Operations (sync interval, auto-post recurring, audit retention):
  `src/components/admin/admin-ops-forms.tsx`, `src/lib/ops-settings.ts`
- Audit log (search, filter, CSV export): `admin-audit-*.tsx`, `src/lib/audit-log.ts`,
  `src/app/api/admin/audit/export`
- System (health, storage, migration health, env config, runtime metrics, backup):
  `admin-system-health.tsx`, `admin-migration-health.tsx`, `admin-env-config.tsx`,
  `admin-runtime-metrics.tsx`, `admin-backup-panel.tsx`

## Signing in

- `/login` (password, passkey, passwordless, Google/SSO), `/mfa`, `/signup`,
  `/forgot-password`, `/reset-password`: `forms/auth-forms.tsx`, `sso-sign-in-forms.tsx`,
  `src/components/mfa/*`, `src/lib/auth-options.ts`, `webauthn.ts`, `mfa-session.ts`
- Rate limits and stale sessions: `src/lib/rate-limit.ts`, `stale-session.ts`

## Background and outside the app

- Schedulers started in `src/instrumentation.ts`: Plaid sweep
  (`src/lib/plaid-sync-scheduler.ts`), recurring auto-post
  (`src/lib/recurring-auto-post-scheduler.ts`)
- Email digest, bill reminders and charge alerts, hourly: `src/lib/email-digest-scheduler.ts`
- Budget alert emails: `src/lib/budget-alert-dispatch.ts`, `budget-alert-email.ts` (sent after any
  spending change, including automatic recurring posts from `src/lib/recurring-post.ts`)
- Health check `/api/health`; schema repair on start `scripts/repair-sqlite-schema.cjs`
- Project website (GitHub Pages): `site/`, `.github/workflows/pages.yml`
