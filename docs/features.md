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
  rule opens on the dashboard at its month and a found account opens its account page (`?open=<id>`, read by the expense, income and
  transfer logs and the Recurring card); an add opens the Add card on desktop or the quick-add
  sheet on phones (`?add=<kind>`, `src/lib/search/dashboard-requests.ts`)
  - **Type-to-add**: "12.50 tim hortons yesterday" (an amount, a title, optionally today /
    yesterday / a weekday / "oct 27" / an ISO date) offers "Add expense $12.50 Tim Hortons, Oct 27"
    first, with the category and account the user's rules and past titles give it ("Add transfer …"
    when a "Mark as transfer" rule matches, booked as one); Enter adds it, and Undo deletes it again. Parser `src/lib/search/quick-add.ts`, preview
    `quick-add-server.ts` (in the `/api/search` answer), save `src/app/actions/quick-add.ts`
    (through `createTransactionFromApi`, not marked for review)
- **Search all transactions** (`/search`): every match across months, grouped by month, with
  type / account / category / tag filters and spent/received totals; where a category or tag
  found by the master search lists its transactions. `src/app/search/page.tsx`
  - **Saved searches**: "Save this search" names the filters on screen (`SavedSearch` table, up to
    50); they are listed on `/search` and in the master search (all when the box is empty, by name
    otherwise), each with how many transactions it finds and their spent/received total, worked
    out each time. Deleting an account, category or tag a search uses deletes it; merging moves it.
    `src/lib/search/saved-searches.ts` (also saves and deletes them, for the phone too),
    `src/app/actions/saved-searches.ts`; in backups
- **Account pages** (`/accounts/[id]`): balance now and month-end balances over the year (the
  readings net worth uses), money in and out this month, card limit/utilization/due day, the
  register for 3 or 12 months with a running balance worked back (and forward, marked) from the
  latest reading, linked bank status and rows waiting in the queue, recurring rules and savings
  goals on the account, and links to all transactions, Reconcile and Settings. Linked from the
  master search, Reports Net worth by account, Debt payoff, the Settings → Accounts drawer and the
  expense edit dialog. `src/app/accounts/[id]/page.tsx`, `src/lib/account-page-data.ts`,
  `src/lib/account-register.ts` (on `moneyIntoAccount` from `reconciliation.ts`)
- **Not-found and error pages** in the app's dark style: `src/app/not-found.tsx`, `src/app/error.tsx`,
  `src/components/status-page.tsx`
- **Installable web app**: `src/app/manifest.ts`, `src/components/pwa/*` (install prompt, offline
  banner, private-cache purge on sign-out, service worker), `/offline`
- **Local notifications** for budget alerts: `src/lib/pwa-notifications.ts`
- **Phone notifications (Web Push)** for bill reminders, charge alerts and budget alerts, even with
  the app closed; see Settings → Notifications → Phone notifications. Push handler in `public/sw.js`

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

**Planned one-offs** (`PlannedTransaction`): a car repair in March, a tax refund in April. Added on
the Add card's Plan tab or Upcoming bills' **+ Plan** (`src/components/planned-transactions.tsx`,
`src/app/actions/planned.ts`): kind, name, amount, date, account, category. Each open plan is a
single occurrence in Upcoming bills, Calendar, Safe to spend, projected balances and What if
(`plannedAsForecastRules` in `src/lib/planned-transactions.ts`). An entry arriving in the log by any
route settles it (`settlePlannedTransactions`, run before plans are read): same account and type,
recorded after the plan, dated a week before to two weeks after it, and the same amount, or the
same category within 10%. Deleting that entry reopens the plan. A plan past its date asks "Did this
happen?": **Yes, add it** records it on its date; **No, remove it** drops it. In JSON backups.
Recording is `recordPlannedTransaction` in `src/lib/planned-transactions-record.ts`, shared with
the phone.

Cards (`src/components/dashboard-cards/`), with their gear settings:

| Card (id) | Features | Settings |
| --- | --- | --- |
| Add (`add-expense`) `add-entry-card.tsx` | Expense / Income / Transfer / Plan switch (Plan: see Planned one-offs below), title autocomplete (`expense-title-autocomplete.tsx`), rules applied while typing (`transaction-rules-context.tsx`) | posted date, note, receipt breakdown |
| Expense Log (`expense-log`) `src/components/expense-log.tsx` | search, tag filter, **Needs review** filter for rows nobody typed in (CSV/OFX imports, recurring auto-posts, API posts; `Transaction.needsReview`; "Mark N shown as reviewed", bulk "Mark reviewed", saving the edit dialog clears it; count on the monthly review), day groups, verified badge, edit dialog (dates, note, tags, splits, credits, owed shares, receipts: photos or PDFs kept in `TransactionAttachment`, type read from the bytes, served by `/api/attachments/[id]` (and to the phone by `/api/v1/attachments/[id]`); up to 8 MB each and 500 MB per user; `receipts-section.tsx`, `src/lib/attachments.ts`; kept through Undo; not in JSON backups), **Select** mode for bulk changes (`expense-bulk-bar.tsx`, `bulkEditExpensesAction`: set category, set account, add tag, delete with one Undo; split expenses keep their categories), delete with an Undo toast (`undo-toast.tsx`, `src/lib/transaction-undo.ts`, kept 15 minutes in `DeletedTransaction`; Undo keeps the Needs review flag and closes the one-off plan the entry came from again, if still open); Owed to you (`owed-to-you.tsx`); Transfers list (`transfer-log.tsx`: mark/unmark, pair/unpair, set account, amounts in the account's own currency, a "Needs review" chip and **Mark reviewed** for imported or auto-posted transfers, both legs of a pair at once); bank review queue | density, list height, show review queue |
| Income (`income`, conditional) `income-card.tsx`, `income-log.tsx` | list, edit, delete (with Undo); **Needs review** chip and filter for income nobody typed in (imports, recurring auto-posts, API posts) with "Mark N shown as reviewed" (`needs-review-filter.tsx`, shared with the Expense Log; `markTransactionsReviewedAction`); absent from a period with no income | density, list height |
| Budgets (`budgets`) `budgets-card.tsx` | progress per category with "$X left" / "$X over" on each row and the total, days left in the current month, rollover (`src/lib/budget-rollover.ts`), reallocate (`budget-reallocate-dialog.tsx`), rows under category group headings with group totals, yearly budgets as sinking funds, each name opening its category trend page | per row, hide zero spend, period note |
| Spending by category (`spending-by-category`) `spending-by-category-card.tsx`, `category-spend-pie.tsx` | pie with colors shared with the log (`src/lib/category-colors.ts`), optional savings slice (`src/lib/savings-transfers.ts`), clicking a category slice opens its trend page | chart height, slices shown, show savings, add up category groups |
| Cumulative spending (`cumulative-spend`) `cumulative-spend-card.tsx`, `src/lib/cumulative-spend.ts` | running total, expected line, compare with last month / 3-month avg | chart height, expected line, compare with |
| Recurring (`recurring`) `recurring-card.tsx`, `recurring-transactions-panel.tsx`, `recurring-rule-form.tsx` | rules due in the month as one summary line each (category · account · cadence · date), overdue carry ("Unposted since"), Post, with Skip/Edit/Disable/Remove behind the "⋯" button, auto-post, new/edit/pause/delete, recurring transfers (from/to account, `RecurringTransaction.transferAccountId`, kept out of income and bills), **twice a month** cadence (`SEMI_MONTHLY`: two days, default the 15th and last day, `anchorDay` + `secondAnchorDay`; optional move to the Friday before a weekend, `beforeWeekend`; every forecast, calendar and reminder follows it), a rule on an account in another currency shows its amount in that currency, cash-flow summary; `src/lib/recurring-transactions.ts`, `recurring-post.ts`, `recurring-skip.ts` (Post and Skip, shared with the phone) | cash-flow summary, rules shown |
| Insights (`insights`) `insights-card.tsx` | count per section and the most pressing few, link to `/insights`; leaves out budget and money-owed insights, which this page already shows | insights shown |
| Upcoming bills (`bills-forecast`) `bills-forecast-card.tsx`, `src/lib/bills-forecast.ts`, `bills-forecast-list.ts` (the list, shared with the phone) | bills and income due by day, running net; open one-off plans with a **Planned** chip, "Did this happen?" for plans past their date, **+ Plan** button (the phone's way to plan); recurring transfers (**Transfer**, from and to account) and each credit card's next payment by its due day (**Card payment**, balance owed and minimum; a card a recurring transfer pays is left to that transfer, `cardPaymentsDue` in `src/lib/credit-cards.ts`, shared with bill reminders), listed but kept out of the totals and running net; a subscription's **Decide by** date on its first charge | days ahead (30/60/90), show transfers and card payments |
| Safe to spend (`safe-to-spend`, tab beside Budgets) `safe-to-spend-card.tsx`, `src/lib/safe-to-spend.ts`, `safe-to-spend-data.ts` | what is free to spend until month end, always for the month now running: income received − spent + recurring and planned income still due − recurring and planned bills still due (outside budgeted categories) − what is left in budgets (with rollover) − savings goals' monthly need; a-day figure for the days left; also a line in the email digest. Opt-in zero-based mode (checkbox on the card, `User.zeroBasedBudgeting`, `zero-based-card.tsx`, `src/lib/zero-based.ts`): shows "To assign" instead = this month's income received and still expected − budgets as set (rollover carries left out) − bills and spending outside budgets − savings goals, plus overspent budgets to cover from another budget | show breakdown |
| Calendar (`calendar`, tab on Cumulative spending) `calendar-card.tsx`, `src/lib/spending-calendar.ts`, `calendarBillsFor` in `bills-forecast-list.ts` (shared with the phone) | the month on screen as a Sunday-first grid: each day's spending and income, dots for recurring bills and pay still due (red when unposted), ringed for one-off plans, violet dots for recurring transfers and card payments due, busiest day outlined; a day opens the dashboard on that one day (`?range=custom&from=&to=`); asks for a single month otherwise | show recurring due |
| Investments (`investments`, tab on Insights) `investments-card.tsx` | contributions/withdrawals, count a transfer toward room, portfolio snapshots, room left (`src/lib/contribution-room.ts`), each account's value and return this year and over 12 months (from `loadInvestmentReturns`, as on Reports; loaded only while the card is placed); `actions/investments.ts`, saving through `src/lib/investment-edits.ts` (shared with the iPhone app's Investments) | room left, add forms, value and return, recent activity |

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
- **Review queue** in the Expense Log and on the phone's Review tab: `plaid-review-queue.tsx`,
  `src/lib/plaid/review.ts` (the writes), `review-decisions.ts` (each decision whole, shared by the
  website's actions and the phone's routes), `review-queue-view.ts` (rows as shown, shared too),
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

- **Financial score** in four pillars with their own scores (FinHealth-style): **Spend** (savings
  rate, fixed bills plus the debt payments that count, budgets kept monthly and yearly, spending
  trend, cash buffer: how low chequing and cash got in days of spending, or months in the black
  without balances), **Save** (emergency fund, aiming for 6 months instead of 3 when income swings;
  long-term savings into TFSA/RRSP/FHSA/investments, against an age benchmark with
  `User.birthYear`), **Borrow**, only when debt is a problem (a card carrying more than its last
  60 days of charges, with utilization; a loan or mortgage paid less than its minimum; interest
  and fees, capped on an NSF or late fee), **Plan** (net worth direction without hand-typed
  property, cash outlook from `projectBalances` 60 days out, dated savings goals on pace). A
  mortgage payment counts with the bills, as housing. Needs/wants/saved split (50/30/20) from
  `Category.spendingRole` or a guess from the name and group. Each closed month is saved once
  (`FinancialScoreSnapshot`), so the card says how the score moved and which factor moved most,
  and the Monthly review shows the month's score. A "possible gaps in your data could change
  this" line links to Possible gaps, here and on Reports; accounts in another currency it leaves
  out are named under "How this is worked out": `financial-score-card.tsx`,
  `src/lib/financial-score.ts`, `financial-score-inputs.ts` (balances walked back by
  `buildRegister`, loan payments, net worth movement), `financial-score-data.ts`,
  `src/lib/card-charges.ts` (shared with the action plan)
- **Savings goals card** (progress, what a dated goal needs a month, and an estimated completion
  date with or without a target date: from the linked balance's growth, or from net transfers
  into the account when the balance has too few readings): `savings-goals-card.tsx`,
  `savings-goal-progress.tsx`, `src/lib/savings-goals.ts`, `savings-goals-data.ts`
- **Coming up** (an account the recurring bills take below zero, from `projectBalances` and a
  balance read in the last month; a budget over, on pace to go over or nearly used this month,
  left off the dashboard card, which has the budget alerts panel; a yearly charge due within 30
  days; a credit card payment due within a week, with its balance and minimum; pay that is late or came in short, `changes.ts`; RRSP room left in the first 60 days of
  the year and FHSA room that will not carry over, Canada only, `standing.ts`): `ahead.ts`
- **Possible gaps in your data** (pay, savings transfers, card payments and other transfers that
  skipped an occurrence, or are past due, leaving pay that is late right now to Coming up; recent
  months with no income for someone who usually has some; an account used about weekly that went
  quiet for three weeks or more): `gaps.ts`; what would move the financial score (an emergency-fund
  balance older than the account's latest entries, or none; bills noticed but not set up as
  recurring; card payments and moves between accounts booked as spending or income; transfers
  that name no destination, or keep going into an account not marked "Counts as savings"; a card
  the score counts with no limit, a loan or mortgage with no minimum, or one with a minimum and no
  payment seen): `score-gaps.ts`
- **Recurring charges we noticed** (track as recurring): `recurring-detection.ts` (pay on two fixed days of the month is told apart from every two weeks by its dates, `semiMonthlyScheduleOf`); a new
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
  `src/lib/insights/dismiss.ts` (shared with the phone app), `src/components/insights/insight-item.tsx`

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
  the printable summary. Open one-off plans are applied too (`loadProjectionInputs`)
- **What if…** under projected balances: try a new recurring bill or income from a date, an
  income change by a percentage from a date, or dropping recurring bills or planned one-offs, and see net worth at
  30 / 90 / 180 days and a year against today's plan, with any account that would go below zero.
  Held only in the browser; nothing is saved. `src/components/reports/what-if-panel.tsx`,
  `src/lib/forecast-scenarios.ts` (on `projectBalances`, which takes other horizons via `days`)
- Income vs spending by month from the first month with data (table toggle), cash-flow Sankey, year over
  year (says so instead of zeros when there is no earlier year), payees, and "Who paid you" for income
- **Merchant page** `/reports/merchant`: `src/app/reports/merchant/page.tsx`,
  `src/lib/reports/category-merchant-data.ts` (shared with the iPhone app)
- **Category trend page** `/reports/category?id=`: one category's last 24 months by month
  against its monthly budget (stepped line), this month, its pace to month end, the average of
  up to 12 full months, top payees (linking to the merchant page), biggest purchases (split
  parts count), and a link to its transactions in `/search`. Income categories show income.
  Opened from category names in Reports' year over year, the Budgets card and the pie's
  slices. `src/app/reports/category/page.tsx`, `src/lib/reports/category-trend.ts`,
  `src/lib/reports/category-merchant-data.ts` (shared with the iPhone app)
- **Year-end summary** `/reports/year` ("Year-end summary" on Reports; last year by default):
  year totals and comparison with the year before, biggest month, top categories and payees;
  totals per tag with tax-looking names (donation, medical, deductible…) first and marked "Tax
  time"; contributions and withdrawals per registered account from the Investments card; Print
  and a CSV for the year. `src/app/reports/year/page.tsx`, `src/lib/reports/year-summary.ts`
- **Monthly review** `/reports/month?month=YYYY-MM` ("Monthly review" on Reports; the month just
  finished by default; linked from the monthly email digest): month totals against the month
  before, categories that moved most, where it went, biggest purchases, budgets kept and missed
  with whether each leftover or overspend rolls into next month, bank rows still waiting for
  review, the month's saved financial score against the month before, and "Mark month closed" /
  Reopen (`MonthClose`, a record only: nothing is locked).
  `src/app/reports/month/page.tsx`, `src/lib/reports/month-recap.ts`,
  `src/lib/reports/month-review-data.ts` (shared with the iPhone app), `actions/month-close.ts`,
  `src/components/reports/month-close-button.tsx`
- **Debt payoff** `/reports/debt` (linked from Net worth when there is a card or loan): each
  card's, loan's and mortgage's balance, interest rate and minimum (`Account.interestRateBps`,
  `.minimumPaymentCents`, set on the page), and a plan for a monthly amount comparing highest
  rate first, smallest balance first and minimums only (debt-free month, interest, payoff order):
  `src/app/reports/debt/page.tsx`, `src/lib/debt-payoff.ts`, `actions/debt.ts`
- **Investment returns** (Reports, under Net worth, once an investment account has two value
  readings): per TFSA/RRSP/FHSA/non-registered account (or any account with portfolio snapshots)
  and all together: value, put in, growth, and the money-weighted return (XIRR) this year, over 12
  months and since the first value (a year's rate from a year of history, the period's own rate
  below that). Cash flows are Investments-card contributions and withdrawals plus transfers in
  and out not already counted toward room. Also on the account page, and offered as the
  Retirement page's return ("Use X%"). `src/lib/investment-returns.ts`,
  `investment-returns-data.ts`, `src/components/reports/investment-returns-section.tsx`
- **Retirement** `/reports/retirement` (linked from Net worth): a deterministic Canadian FIRE projection in today's
  dollars (return net of inflation, no Monte Carlo). Starts from the last 12 months' income and spending, TFSA/RRSP/FHSA/
  non-registered balances and this year's entered contribution room; your age starts from the year of birth on
  Profile when one is set; all inputs editable in a GET form. Savings go TFSA,
  then RRSP (18% of income up to the dollar limit), then FHSA (if saving for a first home; $8,000/yr, $40,000 lifetime),
  then non-registered; retirement spending comes from non-registered, FHSA/RRSP, then TFSA, before tax. Shows the FI
  number (spending ÷ withdrawal rate), FI age, savings at retirement, the age money runs out, and a year-by-year table:
  `src/app/reports/retirement/page.tsx`, `src/lib/retirement.ts`, `src/lib/retirement-data.ts`
- **Print and templates** `/reports/print`: `printables-panel.tsx`, `src/lib/printables/*`,
  `src/app/api/printables/*`. Financial summary PDF, action plan (3/6/12/24+ months, blank
  version), 10 templates (budget, bills, goals, debt, net worth, subscriptions, sinking funds,
  paycheque, spending log, accounts) filled or blank, PDF or CSV

## Settings (`/settings/*`)

Sections are defined once in `src/lib/settings-sections.ts` (sidebar, home list, search, legacy
`#hash` redirects). Pages: `src/app/settings/<id>/page.tsx`; nav
`src/components/settings/settings-nav.tsx`.

- **You**
  - Profile (name, country, timezone, optional year of birth for the financial score and the
    Retirement page's starting age): `settings/you-forms.tsx`, `actions/auth.ts`
  - Security (password, passkeys, authenticator app, recovery codes, linked Google/SSO, sign out
    everywhere): `security-panel.tsx`, `actions/mfa.ts`. Authenticator app (TOTP: QR code or key
    to type, confirmed by the first code; accepted on `/mfa` and for step-up and Confirm it's
    you, where an in-page dialog asks for the code): `src/lib/totp.ts`, `totp-credentials.ts`,
    `src/components/mfa/second-factor.tsx`, `TotpCredential` table. **Signed-in apps** (phones
    signed in to the phone app, each with Sign out; `settings/signed-in-apps.tsx`)
  - Phone app sign-in (server side; the app is in `mobile/`, see "iPhone app" below): `/app/authorize` page where a
    signed-in person allows a phone (`app-authorize-consent.tsx`, `actions/app-devices.ts`, needs
    Confirm it's you), `POST /api/v1/app/token` (one-time code + PKCE verifier for a device token),
    `POST /api/v1/app/revoke`, `GET /api/v1/me`, public `GET /api/v1/server`; `src/lib/app-devices.ts`,
    `AppDevice` and `AppSignInCode` tables. Device tokens work on every `/api/v1` route. Signed-out
    visits to `/app/…` go to `/login?next=` and come back (`src/proxy.ts`). Face ID sign-in for
    the app's home server (`APPLE_APP_ID` set): `/.well-known/apple-app-site-association`
    (`src/lib/apple-app-site.ts`), `POST /api/v1/app/passkey/options` and `/token`
    (`src/lib/app-passkey-sign-in.ts`), advertised as `passkeySignIn` in `GET /api/v1/server`
  - Notifications (budget alert emails): `budget-alert-preferences.tsx`,
    `src/lib/budget-alert-dispatch.ts`. The digest, bill reminder, charge alert and budget email
    settings are saved through `src/lib/alert-timing.ts`, shared with the iPhone app's When alerts come
  - Email digest (off / weekly on Mondays / monthly on the 1st, after 7am local; spent and
    received, top categories, biggest purchases, budgets over 80%, bills coming up, review
    queue count, safe to spend for the month; skipped when empty; "Send me one now"): `email-digest-preferences.tsx`,
    `src/lib/email-digest.ts`, hourly `email-digest-scheduler.ts` (`EMAIL_DIGEST_SCHEDULER`)
  - Bill reminders (off / the day before / 3 days / a week before; one email listing recurring
    bills and transfers coming up, each occurrence reminded once via
    `RecurringTransaction.reminderSentForDate`, plus credit card payments by their due day; same hourly sweep, after 7am local):
    `bill-reminder-preferences.tsx`, `src/lib/bill-reminders.ts`
  - Charge alerts (an email when a bank sync brings in money out at or over an amount, home
    currency only, and/or at least 3× and $25 above the merchant's usual from 3+ earlier
    charges; each staged row looked at once via `ChargeAlertSetting.checkedThrough`; turning
    on starts from now; same hourly sweep, any hour): `charge-alert-preferences.tsx`,
    `src/lib/charge-alerts.ts`
  - Phone notifications (Web Push: "Turn on for this device", then per device which of bill
    reminders, charge alerts and budget alerts it gets; "Send a test"; other devices listed with
    Remove. iPhone needs the app on the Home Screen, iOS 16.4+. Sent alongside the email, or
    instead of it when SMTP is not set up; budget alerts can go to a phone without the email
    toggle): `push-notification-preferences.tsx`, `actions/push.ts`, `src/lib/push-notifications.ts`
    (`deliverAlert`, the one place the three alerts go out; VAPID keys made once in
    `ServerSetting`), `src/lib/web-push.ts` (RFC 8291 encryption and RFC 8292 VAPID, no package;
    posts only to the browsers' push services), `PushDevice` table. The same alerts go to the
    iPhone app by Apple push once an admin saves Apple's key: `src/lib/apns.ts` (HTTP/2 and an
    ES256 token, no package), `AppPushToken` per signed-in phone with its own switches and "hide
    amounts", registered by `PUT /api/v1/app/device/push` (`src/lib/api-v1/app-push.ts`)
  - Calendar feed (a private `.ics` link for Google/Apple/Outlook: each recurring bill, payday
    and transfer for the next 12 months and each subscription decide-by date, all-day with the
    amount in the title; made after "Confirm it's you", shown once, only its hash kept in
    `CalendarFeed`; "Make a new link" replaces it, "Turn off" removes it; served by
    `GET /api/calendar/<secret>.ics` outside the session gate): `calendar-feed-preferences.tsx`,
    `src/lib/calendar-feed.ts`, `actions/calendar-feed.ts`
  - Appearance (dashboard readability, install app): `src/lib/dashboard-readability.ts`;
    the check counts every tab of a stack, so switching tabs never changes the column count
    (`src/lib/dashboard-layout/text-visibility.ts`)
- **Money**
  - Accounts (add/edit/archive/delete, default expense account, currency, balances, counts as
    savings, contribution room; types include Loan and Mortgage, kept apart for the score): `settings/accounts-manager.tsx`, `account-balances-panel.tsx`,
    `contribution-room-panel.tsx`, `actions/accounts.ts`. Currency is fixed once an account has
    transactions, recurring rules, balances or a bank mapping, and a non-home-currency account
    with transactions can only be archived, not deleted (`src/lib/account-currency-guard.ts`).
    Adding, editing, archiving and the card's limit and due day save through
    `src/lib/account-edits.ts`, shared with the iPhone app
  - **Credit card limit and due day** (a credit card's drawer, "Card": `Account.creditLimitCents`,
    `.paymentDueDay`, `setCardTermsAction` in `actions/debt.ts`). Utilization (owed ÷ limit,
    flagged over 30%) on the drawer, Reports Net worth (per card and in total) and Debt payoff;
    the due day feeds Insights' Coming up and bill reminders (`Account.paymentRemindedFor`; a card
    a recurring transfer already pays is left to that transfer): `src/lib/credit-cards.ts`
  - Reconcile with a statement (`/settings/accounts/reconcile`, "Reconcile" on Accounts): dates
    and opening/closing balances in, the log's entries with a running balance and the difference
    out (cards and loans as amounts owed); "Mark reconciled" keeps an `AccountReconciliation` and
    the closing balance as a manual balance unless the bank reported that day:
    `src/lib/reconciliation.ts`, `actions/reconciliation.ts`
  - Savings goals: `settings/savings-goals-panel.tsx`, `actions/savings-goals.ts` (add, edit, delete
    and money in or out share `src/lib/savings-goal-edits.ts` with the iPhone app)
  - Connected banks: see Bank sync
  - Categories & budgets (add, rename, merge, delete with reassign, budget, rollover, earlier
    budgets, bank mapping, group, need or want for the score's 50/30/20 split):
    `categories-panel.tsx`, `settings/budget-history.tsx`,
    `actions/categories.ts`, `actions/budgets.ts`. **Category groups** (`Category.groupName`, a
    shared label, matched ignoring case; `src/lib/category-groups.ts`): the list is shown under
    group headings with each group's budget and spend; the Budgets card shows its rows under
    group headings with the group's total and what is left; the pie adds each group up (card
    setting "Add up category groups", on by default); Reports has "Spending by group". **Yearly
    budgets** (`YearlyBudget`, one row per category and year, the latest on or before the year
    shown applying; `src/lib/yearly-budgets.ts`, "Yearly budget" in a category's settings): shown
    as sinking funds in a "Yearly budgets" section of the Budgets card (spent this year of the
    limit, a twelfth a month, and what the fund holds: set aside so far less spent), kept out of
    the monthly totals and alerts; in backups. **Suggest budgets** (button above the list; the
    Budgets card's empty state and Get started link to `?suggest=1`, which opens it): a monthly
    amount per expense category from the last 3 or 6 full months since the first transaction,
    the median month (a one-off month is marked and passed over) rounded up, with a tick box
    and an editable amount per row and the total against average income; ticked rows are set
    from this month on. `src/lib/budget-suggestions.ts`, `budget-suggestions-data.ts`,
    `settings/budget-suggestions.tsx`, `applyBudgetSuggestionsAction`
  - Rules (title/type/account/amount conditions, the title matching any of up to 20 texts —
    "contains Bell Aliant Pap or Internet", stored one per line in `titlePattern`; set category, title, amount, account, note,
    tag, mark as transfer; priority, enable, preview and apply, learned suggestions):
    `transaction-rules-panel.tsx`, `src/lib/transaction-rules.ts`,
    `transaction-rules-server.ts`, `transaction-rule-edits.ts` (adding and applying a rule, shared
    with the iPhone app)
  - **Split by percentage** (rule action, expenses only, e.g. Costco 70% Groceries / 30% Household;
    `TransactionRuleSplit` table): the Add form offers it ("Book whole" declines), CSV import and the
    API split unless the row names a category, the bank queue splits while the row keeps the
    rule's category (not "Add with category"), apply to past splits matching expenses without owed
    shares; cents from `splitCentsByShares`, written as `SplitTransactionPart`; in backups
  - Tags (rename, merge, delete): `settings/tags-panel.tsx`, `src/lib/tags*.ts`
  - Subscriptions (shared members, who paid, skip occurrence): `subscriptions-panel.tsx`,
    `actions/subscriptions.ts`, `src/lib/recurring-skip.ts`
  - **Subscription cancel helper** (Recurring card and rule form, bills only): "Where to cancel"
    (a link, shown as "Cancel page", or a note) and a "Decide by" date for a trial turning paid or
    a plan renewing, shown as a chip; the bill reminder email warns before that date, once per date
    (`decideRemindedFor`, only while bill reminders are on); "Cancel subscription" (⋯, in-page
    confirm) turns the rule off and sets `cancelledAt`, and Insights' Going well shows "Cancelled X:
    saving $Y a year" for 90 days; Enable undoes it. `src/lib/subscription-cancel.ts`,
    `actions/recurring.ts` (`cancelSubscriptionAction`), `recurring-transactions-panel.tsx`,
    `recurring-rule-form.tsx`, `bill-reminders.ts`
- **Data**
  - Import a CSV, OFX or QFX statement with summary (rows already in the log on the same
    account are skipped). Amount sign either way round, or separate debit and credit columns
    (`statementOutflow`); money coming in is a refund (negative expense) or, if chosen, income
    in a picked category. OFX/QFX is read into the same column table (`src/lib/ofx.ts`):
    `forms/expense-forms.tsx`, `forms/csv-import-summary-dialog.tsx`, `src/lib/csv-import.ts`
  - Backup & export (JSON export, transactions as CSV for all time or a date range
    (`src/lib/transactions-csv.ts`, `src/app/api/export/transactions`), restore up to 20 MB, clear data, delete account):
    `settings/data-forms.tsx`, `src/lib/backup*.ts`, `src/app/api/backup/export/me`. Clear and restore share one
    wipe list (`src/lib/user-data-wipe.ts`); what the JSON leaves out on purpose (bank connections, receipts,
    sign-in methods, webhooks, dashboard layout) is listed on `UserBackupPayload`. Text over the length limits
    (`src/lib/text-limits.ts`) in an older file is cut to fit rather than refused
  - Developer (API tokens with chosen scopes; `GET /api/v1/budgets`, `GET`/`POST /api/v1/transactions`
    (expenses, income and transfers; a post a "Mark as transfer" rule matches is booked as a transfer
    unless it names a category; `Idempotency-Key` makes retries safe, `src/lib/api-v1/idempotency.ts`),
    `GET /api/v1/accounts`, `GET /api/v1/categories`, `GET /api/v1/tags`; search with `?q=`, `?tagId=`,
  `?needsReview=`): `api-tokens-panel.tsx`, `src/lib/api-token.ts`,
    `src/lib/api-v1/*`, `src/app/api/v1/*`
  - Webhooks on the Developer page (endpoints picking events: transaction added, CSV import, budget over,
    bill due, bank sync failed; adding one needs "Confirm it's you"; public https addresses, or the local network
    for server admins only, checked again at each send (`src/lib/webhook-address.ts`); `transaction.created`
    has one payload from every entry path (`emitTransactionsCreated`); nothing goes out for a suspended user;
    secret shown once, stored encrypted; each POST signed with
    `x-webhook-signature: t=<unix>,v1=<HMAC-SHA256 of "t.body">`; retries with growing gaps up to 6 attempts on
    the hourly digest scheduler tick, which also queues bill-due events and prunes rows after 30 days):
    `webhooks-panel.tsx`, `src/app/actions/webhooks.ts`, `src/lib/webhooks.ts`, `src/lib/webhook-events.ts`

## Admin (`/settings/admin/*`, admins only)

Nav `src/components/admin/admin-nav.tsx`; actions `actions/admin*.ts`.

- Overview (attention items): `src/lib/admin-attention.ts`
- Analytics (activity per day; sign-in methods: password, passkey, authenticator app, either second factor, recovery codes, SSO): `admin-analytics-panel.tsx`, `src/lib/admin-analytics*.ts`
- Users (role, disable, force sign-out, delete): `admin-user-table.tsx`, `src/lib/admin-users.ts`
- Authentication (password login, public sign-up, Google/SSO): `forms/admin-forms.tsx`,
  `src/lib/auth-settings.ts`, `oauth-settings.ts`, `signup-policy.ts`
- Integrations (Plaid credentials, all bank connections): `src/lib/admin-plaid-overview.ts`; Apple
  push for the iPhone app (the `.p8` key, key ID, team ID and bundle ID behind Confirm it's you,
  Send a test to my iPhones, Remove key): `AdminApnsForm`, `src/lib/apns-settings.ts`,
  `actions/admin.ts`
- Operations (sync interval, auto-post recurring, audit retention):
  `src/components/admin/admin-ops-forms.tsx`, `src/lib/ops-settings.ts`
- **Automatic database backups** (Operations; on by default): once a day, from the backup hour in
  server time, a `VACUUM INTO` copy of the whole SQLite database into a `backups` folder beside it
  (`BACKUP_DIR` to move it). Keeps the last N days (default 14) plus the newest copy of each of the
  last six months, and never deletes the newest. Settings for on/off, days kept and hour (env vars
  `DATABASE_BACKUPS`, `BACKUP_KEEP_DAYS`, `BACKUP_HOUR` win), the saved copies with sizes, and
  "Back up now" (audited). An attention item on Overview and a dot on Operations when the last
  backup failed or none is newer than two days. `src/lib/database-backups.ts`,
  `src/lib/database-backup-scheduler.ts`, `actions/admin-ops.ts`
- Audit log (search, filter, CSV export): `admin-audit-*.tsx`, `src/lib/audit-log.ts`,
  `src/app/api/admin/audit/export`
- System (health, storage, migration health, env config, runtime metrics, backup):
  `admin-system-health.tsx`, `admin-migration-health.tsx`, `admin-env-config.tsx`,
  `admin-runtime-metrics.tsx`, `admin-backup-panel.tsx`

## Signing in

- `/login` (password, passkey, passwordless, Google/SSO), `/mfa` (passkey, authenticator code or
  recovery code), `/signup`,
  `/forgot-password`, `/reset-password`: `forms/auth-forms.tsx`, `sso-sign-in-forms.tsx`,
  `src/components/mfa/*`, `src/lib/auth-options.ts`, `webauthn.ts`, `mfa-session.ts`
- **Confirm it's you** before deleting the account, clearing or restoring its data, and the
  admin controls for roles, suspensions, deleting users, sign-in providers, password login,
  public sign-up, Plaid credentials and Apple's push key, and before making a calendar link or adding a webhook: a passkey or authenticator code if the account has one, else the password,
  else (SSO only) a sign-in in the last five minutes; one confirmation covers five minutes.
  `src/components/mfa/confirm-identity.tsx`, `requireRecentIdentity` in
  `src/lib/recent-identity.ts`; see `docs/access-control.md`
- Rate limits and stale sessions: `src/lib/rate-limit.ts`, `stale-session.ts`

## Background and outside the app

- Schedulers started in `src/instrumentation.ts`: Plaid sweep
  (`src/lib/plaid-sync-scheduler.ts`), recurring auto-post
  (`src/lib/recurring-auto-post-scheduler.ts`), daily database backup
  (`src/lib/database-backup-scheduler.ts`, hourly check)
- Email digest, bill reminders, charge alerts and outbound webhook deliveries (retries, bill-due
  events, pruning), hourly: `src/lib/email-digest-scheduler.ts`
- Budget alert emails: `src/lib/budget-alert-dispatch.ts`, `budget-alert-email.ts` (sent after any
  spending change, including automatic recurring posts from `src/lib/recurring-post.ts`)
- Security headers, including the enforced Content-Security-Policy: `next.config.ts`
- Health check `/api/health`; schema repair on start `scripts/repair-sqlite-schema.cjs`
- Project website (GitHub Pages): `site/`, `.github/workflows/pages.yml`

## iPhone app (`mobile/`)

An Expo app with its own `package.json`, checks and README (`mobile/README.md`). Installed through
TestFlight only, built on EAS by the **iOS TestFlight** workflow
(`.github/workflows/ios-testflight.yml`, run by hand). JavaScript and asset changes can reach
installed builds without a new build through EAS Update on the `production` channel
(`expo-updates`; runtime version from `fingerprint.config.js`; README → Updates without a new
build).

- Sign in: server address, then the server's own sign-in page in the system sheet (PKCE); the
  device token is kept in the Keychain. `src/screens/sign-in.tsx`, `src/session/*`,
  `src/utils/sign-in.ts`
- Face ID sign-in on the home server (the one a build is made for, `HOME_SERVER_DOMAIN` on EAS,
  never committed): **Sign In with Face ID** uses a passkey added on the web, through iOS's
  passkey sheet, with no browser sheet. The address field starts with that server. On any other
  server the app signs in through the web page and says Face ID sign-in and connecting banks in
  the app are not available there.
  `app.config.ts`, `passkeys/Passkeys.swift`, `src/session/passkeys.ts`,
  `src/utils/passkey-sign-in.ts`, `src/utils/home-server.ts`
- Tabs (`src/app/(tabs)/_layout.tsx`, native tab bar): Home, Transactions, Review (badged with the
  bank rows waiting), Budgets, Settings. Data is cached and
  refetched when the app comes back to the front (`src/api/query.tsx`, TanStack Query)
- Home: safe to spend for the month (the website's number and breakdown), bank rows and entries
  waiting for review (open the Review tab and Transactions' Needs review), budgets at 80% or more with the month's total,
  and bills and pay due in the next 7 days, overdue ones flagged. One call, `GET /api/v1/summary`
  (`src/lib/api-v1/summary.ts`). `src/screens/home/`
- Edit Home (Edit, top left of Home; a sheet): the cards on Home in order, each with a red minus to
  take it off and a handle to drag it up or down (a native SwiftUI list in edit mode), and More
  cards with a green plus to add one at the bottom; Reset Home goes back to the first layout.
  Besides Home's own cards (spending charts included), two are off until added: Recent
  transactions (the newest 5, each opening its editor) and Insights (the most pressing 3, as the
  dashboard card picks them). Kept on the phone per sign-in; a card added in a later version
  appears where it belongs. Cards taken off are not loaded. `src/screens/home/edit.tsx`,
  `src/screens/home/more-cards.tsx`, `src/utils/home-layout.ts`, `src/state/home-layout.ts`
- Home's spending charts, the dashboard's two cards for the month in one card that swipes between
  them (or pick one from the pills under it), as the website's phone carousel does: Spending by
  category (a Swift Charts donut with the dashboard's colours, groups added up and the tail rolled
  into Other categories as the card does, and Show savings) and Cumulative spending (running total
  by day, the expected pace from budgets or the last 3 months, and Compare with: None / Last month /
  3-month avg; a finger on it shows a day, and resting it first reads along the days without turning
  the page). A category's row under the pie opens its category page (below). A third page is the
  dashboard's **Calendar** card: the month as a Sunday-first grid with each day's spending and
  income, dots for bills and pay still due (red while unposted, ringed for a plan, violet for
  transfers and card payments) and the busiest day outlined; a tapped day lists its totals and what
  is due (`GET /api/v1/calendar?month=`, `src/lib/api-v1/calendar.ts`, built with the card's
  `buildCalendarMonth` and the dots from `calendarBillsFor` in `src/lib/bills-forecast-list.ts`;
  `GET /api/v1/me` names `calendar` in `features`; `src/screens/home/calendar.tsx`,
  `src/utils/calendar.ts`). The first two start from the website card's settings; a pick on the phone, and the chart last
  shown, are kept on the phone. `GET /api/v1/spending` (`src/lib/api-v1/spending.ts`, built with the
  dashboard's own functions; the pie's slices from `src/lib/category-pie.ts`, shared with the card).
  `src/screens/home/spending.tsx`, `src/components/swipe-pages.tsx`, `src/components/line-chart.tsx`
  (plain views, no native drawing library), `src/utils/spending.ts`, `src/state/spending-options.ts`
- Transactions: the log a month at a time (‹ ›), grouped by day; search across every month
  (title, note, bank text or amount, as the website's search matches); filter by Needs review
  (every month) and spending, income or transfers. As the website's Search transactions page, the
  filter menu also narrows by **account** (either side of a transfer), **category** and **tag**, any of
  which searches every month; a search shows how many it found and what they spent and received, and
  **Save This Search…** keeps it with the website's saved searches, listed under **Saved Searches** in
  the filter menu with their running totals (one on screen can be deleted there; Needs review is
  never saved). A row opens an editor for title, amount,
  dates, category, account, tags and note, plus Mark reviewed and Delete with an Undo bar. A
  transfer shows From and To in place of category and account, and either can be changed (picked
  the other way round, the transfer is reversed); a paired transfer keeps the accounts of its two
  bank rows until it is unpaired on the website. An expense can be **split across categories**
  (lines with a category and an amount each, adding up to the amount; Remove the split books it in
  one category again) or carry **who owes part of it back** (a name and an amount each; the amount
  becomes "You paid" and only the person's own part counts as spending), never both, checked as
  the website's edit dialog checks them (which edits a split but cannot start one). Credits show but are changed on the website; a transfer's amount is
  not changed anywhere. **Owed to you** (a line above the log while anyone owes something): every
  share outstanding and those paid back in the last 30 days, each with Mark Paid or Undo, opening its
  expense. **Select expenses** (in the filter menu) is the Expense Log's Select mode: tap expenses
  (income and transfers are dimmed), or Select All Shown, then Set Category (split expenses keep
  theirs), Set Account, Add Tag, Mark Reviewed or Delete (one Undo puts them all back), up to 500
  at a time. `GET /api/v1/transactions` (now `q`, `tagId`, `needsReview`, and `bulkEdit`), `POST
  /api/v1/transactions/bulk` (`src/lib/api-v1/bulk-edit.ts`; the Expense Log's action and it share
  `src/lib/bulk-edit-expenses.ts`), `GET`/`PATCH`/`DELETE
  /api/v1/transactions/:id` (`PATCH` takes a transfer's `transferAccountId`, an expense's `splits`
  and `owedShares` with `paidCents`; `GET` lists `owedShares`), `GET /api/v1/owed`,
  `POST /api/v1/owed/:id` (`src/lib/api-v1/owed.ts`, `src/lib/owed-to-you.ts`, shared with the
  Expense Log), `POST /api/v1/undo/:undoId`, `GET /api/v1/tags`
  (`src/lib/api-v1/transactions.ts`), `GET /api/v1/search` (`/search`'s `transactionSearchWhere` and
  totals), `GET`/`POST /api/v1/saved-searches`, `DELETE /api/v1/saved-searches/:id`
  (`src/lib/api-v1/search.ts`; saving and deleting shared with `/search` through
  `src/lib/search/saved-searches.ts`); `GET /api/v1/me` names `search` in `features`.
  `src/screens/transactions/`, `src/utils/search.ts`
- Add (the + on Home and Transactions, a sheet): expense, income or transfer with amount, title, date,
  category and account (Automatic uses the user's rules and past titles, as the website's Add card
  does), a transfer's From and To, tags and note; an Undo bar afterwards. The Transactions search also
  reads "12.50 coffee yesterday" as an add, showing how it would be filed, and adds it in one tap
  (`GET /api/v1/quick-add`). Every add sends an `Idempotency-Key`, so a retry after a dropped
  connection never adds twice. The phone's adds skip Needs review. `src/screens/add/`,
  `src/screens/transactions/quick-add-card.tsx`, `src/utils/add.ts`
- Adding with no connection: the Add sheet opens from the last categories and accounts the server
  sent, and an add the server cannot take (no connection, no answer, a 5xx such as a proxy's for a
  server that is down) is kept on the phone, receipt photo and all, then sent with its original
  `Idempotency-Key` as soon as the server answers: at once, whenever the app comes to the front, and
  every 30 seconds (keys are kept a week, so one that did get through is never added twice; an add
  deleted since answers 410 and is let go). Home and Transactions say what is waiting; its list
  offers Send now and Discard, and shows any the server refused. Signing out lets them go, and says
  so. `src/state/outbox.ts`, `src/api/outbox-sender.ts`, `src/utils/outbox.ts`, `src/screens/outbox.tsx`,
  `src/state/remembered-lists.ts`
- Receipts: a photo from the camera or library when adding (uploaded once the entry is in; a failed
  upload offers Try Again or Skip, never a second entry) or from an entry's editor; photos open full
  screen with pinch to zoom and can be removed; PDFs are listed and open on the website.
  `POST /api/v1/transactions/:id/attachments` (multipart), `GET`/`DELETE /api/v1/attachments/:id`,
  receipts listed on `GET /api/v1/transactions/:id`; the website's limits and type checks
  (`src/lib/attachments.ts`). `src/screens/transactions/receipts.tsx`, `src/screens/receipt.tsx`,
  `src/utils/pick-receipt.ts`, `src/api/receipts.ts`
- Share a receipt (the share sheet in Photos, Mail, Files and other apps, for one photo or PDF):
  Finances opens on the receipt and offers **Add a New Entry With It** (the Add sheet, receipt
  attached, and so it works with no connection too) or one of the latest entries, or one a search
  finds, to keep it with. Shared while the app is locked or signed out, it opens after Face ID or
  signing in. Uses `expo-sharing`'s share extension. `src/screens/share.tsx`, `src/app/+native-intent.ts`,
  `src/launch/shared-receipts.ts`, `src/utils/shared-receipt.ts`
- Siri and Shortcuts: "Log an expense in Finances" (or "Add an expense", "Log a purchase") asks how
  much, then opens the Add sheet with the amount, and from the Shortcuts app what it was for, filled
  in; nothing is saved until Add is tapped. `app-intents/LogExpenseIntent.swift`,
  `app-intents/AppShortcuts.swift` (`expo-app-intents`), `src/launch/siri-adds.tsx`, `src/utils/siri.ts`
- Home Screen widgets: **Safe to Spend** (small, and on the Lock Screen) and **Bills and Pay**
  (medium and large: the next 7 days' bills and pay, as Home lists them). They show what Home last
  loaded, "As of" when; amounts are hidden on a locked phone's Lock Screen; signing out empties them.
  Tapping opens Home or Bills and pay. `src/widgets/` (`expo-widgets`), `src/utils/widgets.ts`
- Review: the bank review queue, every month at once, newest first, as the website's queue offers
  each row: link to the entry it matches, pair two rows as one transfer, add (as a transfer or in a
  category, showing the title, note, tags and split the rules give it) or ignore; Link all strong
  matches and Add all unmatched. **Select** (top right) ticks rows, as the website's queue does, then
  Add them as shown, Add in a Category (offered when they are all spending or all income) or
  Ignore them, all or none, up to 200 at a time (`src/utils/review-bulk.ts`). Each row shows the category it would go in (Transfer for transfers);
  swiping it right uncovers Add (Link or Pair where adding would duplicate an entry or split a
  transfer) and left uncovers Ignore, each done with a tap (`src/components/swipe-row.tsx`: the list
  waits for a sideways drag before scrolling, one row open at a time). The bank's revisions to rows already added (use the bank's amount
  or keep yours); banks that need signing in again, renewing or new accounts open the Banks screen
  (below). Pull down checks the banks now, as the log's refresh icon does. `GET /api/v1/review-queue`,
  `POST /api/v1/review-queue/:id`, `/pair`, `/bulk`, `/revisions/:id`, `POST /api/v1/banks/refresh`
  (`src/lib/api-v1/review-queue.ts`). `src/screens/review/`, `src/utils/review-queue.ts`
- Budgets: any month's budgets by category group, with rollover carries, and the yearly budgets as
  sinking funds; ‹ › switch month. `GET /api/v1/budgets` (now also `groupName`, `rollover`,
  `yearly`, `currentMonth` and `trends`). A budget opens its category page (below); on this month's
  page, that page's Edit (or, with a server without category pages, the budget itself) opens a sheet with what Settings →
  Categories sets: the monthly budget from this month on (cleared, it is removed every month, after
  a confirm), rollover, and the yearly budget; **Add a Budget** does the same for a category without
  one. A budget that is over offers **Cover the $X over from other budgets**, the Budgets card's
  reallocate dialog: other budgets with room, filled in from the roomiest first, any amount
  changeable. `PATCH /api/v1/budgets/:categoryId`, `POST /api/v1/budgets/:categoryId/cover`
  (`src/lib/api-v1/budget-edits.ts`; the website's actions and these share `src/lib/budget-edits.ts`).
  `src/screens/budgets/`, `src/app/budget.tsx`, `src/app/budget-cover.tsx`, `src/utils/budget-edits.ts`
- Monthly review (the checklist button on Budgets; the month shown there, or the month just
  finished when that is this month): the website's Monthly review, ‹ › for another month up to this
  one. Totals against the month before, what changed, where it went, biggest purchases, budgets kept
  with whether each leftover or overspend rolls on, then what still wants a look (bank rows
  waiting, linking the Review tab, and entries needing review, linking Transactions' Needs review)
  and **Mark Month Closed** / **Reopen Month**. `GET /api/v1/month-review?month=`,
  `POST /api/v1/month-review/close` (`src/lib/api-v1/month-review.ts`; the page and these share
  `src/lib/reports/month-review-data.ts`). `src/screens/budgets/review.tsx`, `src/utils/month-review.ts`
- Make a rule ("Make a Rule…" in an entry's editor and on a bank row being added; Settings →
  Suggested rules): the main fields of Settings → Rules' editor, filled in from where it was opened
  (the title as Contains, Is exactly or Starts with, "Only on" the entry's account, then a category,
  a new title and a tag to set), read back as a sentence. Saved after the person's other rules; when
  it fits entries already logged it asks "Change N past entries too?", which is Settings → Rules'
  Apply. Suggested rules lists the learned Title → Category combos no rule decides yet, each opening
  the sheet as "Is exactly"; Hide is the website's Hide. The list itself, ordering and editing stay
  on the website. `POST /api/v1/rules`, `POST /api/v1/rules/:id/apply`,
  `GET /api/v1/rules/suggestions`, `POST /api/v1/rules/suggestions/hide`
  (`src/lib/api-v1/transaction-rules.ts`; the website's actions and these share
  `src/lib/transaction-rule-edits.ts`); `GET /api/v1/me` names `rules` in `features`.
  `src/screens/rules/`, `src/app/transaction-rule.tsx`, `src/utils/transaction-rules.ts`
- Savings goals (Home's Savings goals card, Settings → Savings goals, a goal on an account's page):
  every goal's saved amount of its target, bar and status, what a dated goal needs a month and when
  it would be reached at its pace, as the website's card says it. **Add a Goal** and tapping a goal
  open the sheet with Settings → Savings goals' fields (name, target, an optional date, tracked by hand
  or following an account's balance, saved so far); a hand-tracked goal also has **Add Money** /
  **Take Money Out**, and **Delete Goal** leaves a followed account alone. The Home card shows the
  first three and hides itself without goals. `GET /api/v1/goals`, `POST /api/v1/goals`,
  `PATCH`/`DELETE /api/v1/goals/:id`, `POST /api/v1/goals/:id/contribute`
  (`src/lib/api-v1/goals.ts`, figures from the website's `loadSavingsGoals`; edits shared through
  `src/lib/savings-goal-edits.ts`); `GET /api/v1/me` names `goals` in `features`.
  `src/screens/goals/`, `src/app/goal.tsx`, `src/utils/goals.ts`
- Category and payee pages (a budget row on Budgets, or a category's row under Home's pie): the
  website's category trend page, with up to 24 months as bars (tap one for its month; the line
  across a bar is that month's budget), this month, its pace, its usual month and its budget, top
  payees and the biggest entries. A payee opens the website's payee page: everything from it, by
  month and by category, and its entries (the newest 200). Opened from a budget on this month's page,
  **Edit** opens the budget's sheet. `GET /api/v1/categories/:id/trend`, `GET /api/v1/merchants?key=`
  (`src/lib/api-v1/category-merchant.ts`; the website's pages and these share
  `src/lib/reports/category-merchant-data.ts`); Budgets says `trends` and the pie's slices carry
  `categoryId` when the server has them. `src/screens/reports/`, `src/components/month-bars.tsx`
  (plain views), `src/utils/category-merchant.ts`
- Bills and pay (Home's "Post or skip bills and pay", and a tapped bill reminder): every recurring
  bill, pay and transfer that is on, under Overdue, Today, Next 7 days and Later, each with the
  occurrence it waits on. Swiping right uncovers Post, left uncovers Skip (each done with a tap);
  tapping a row also offers "I already logged it", which links the entry with the rule's name
  within 15 days, as the website does without a pick. Tapping also offers **Change, pause or delete
  the rule**: a sheet with the website's Recurring form (Bill, Income or Transfer; name, amount,
  account, category or To account, repeats, twice-a-month days and Friday-before-a-weekend, next
  date, end date, post by itself, a bill's where-to-cancel and decide-by, note) and **Pause Rule** /
  **Turn Back On**, **I Cancelled This Subscription** (a bill) and **Delete Rule**. Paused and
  cancelled rules are listed under Paused. **+** adds a rule or a one-off plan.
  `GET /api/v1/recurring` (now also `paused` and each rule's form fields), `POST /api/v1/recurring`,
  `PATCH`/`DELETE /api/v1/recurring/:id`, `POST /api/v1/recurring/:id/post`, `/skip`, `/enabled` and
  `/cancel` (`src/lib/api-v1/recurring.ts`, `recurring-rules.ts`; the Recurring card's actions and
  these share `src/lib/recurring-rules.ts`, and post and skip are the website's
  `postRecurringOccurrence` and `skipRecurringOccurrence`). `src/screens/bills/`, `src/app/recurring-rule.tsx`,
  `src/utils/recurring.ts`, `src/utils/recurring-rules.ts`. Planned one-offs sit on the same screen: a plan past its date first,
  under "Did this happen?" (tap: Yes, add it to the log; No, remove the plan; or change it), the
  rest under One-off plans after the bills (tap to change or remove). **+** adds one in a sheet
  with the website's fields (Expense or Income, name, amount, day, account, category, note).
  `GET`/`POST /api/v1/planned`, `PATCH`/`DELETE /api/v1/planned/:id`, `POST /api/v1/planned/:id/record`
  (`src/lib/api-v1/planned.ts`). `src/app/plan.tsx`, `src/screens/plans/`, `src/utils/plans.ts`
- Upcoming bills (Home's Next 7 days card, "See the next 30, 60 or 90 days", and the button at the
  top left of Bills and pay): the website's Upcoming bills card. 30, 60 or 90 days of bills, pay and
  open plans by day (this month's overdue ones first), each day with the running net, and income due,
  bills due and net above; with "Transfers and card payments" on (the default), recurring transfers
  and each card's next payment by its due day (balance owed and minimum) are listed outside the
  totals and the running net. The chips are the website's: Card payment or Transfer, Decide by,
  Planned, Overdue, Unposted since. A line opens its rule, its plan, or the card's account page.
  `GET /api/v1/bills/forecast?days=&transfers=` (`src/lib/api-v1/bills-forecast.ts`; the dashboard
  card and it share `src/lib/bills-forecast-list.ts`); `GET /api/v1/me` names `forecast` in
  `features`. `src/screens/bills/forecast.tsx`, `src/utils/bills-forecast.ts`
- Insights (Home's "See insights and where to improve", under the score): the financial score with
  its four pillars, where to improve and how it is worked out, then every insight under the
  website's sections, each with its transactions, its website page when it has one (tracking a
  recurring charge, a budget or rule opens the website in Safari), and the website's Snooze, Dismiss,
  Not recurring or Don't flag this; dismissed and snoozed ones can be put back. Home shows the score
  and how it moved. `GET /api/v1/score`, `GET /api/v1/insights`, `POST /api/v1/insights/dismiss` and
  `/restore` (`src/lib/api-v1/insights.ts`, the website's `loadInsights` and `loadFinancialScore`;
  `src/lib/insights/dismiss.ts` behind both apps' buttons). `src/screens/insights/`, `src/utils/insights.ts`
- Accounts (Home's Net worth card, "See accounts and their registers"): net worth with what you have
  and what you owe, then every open account with its latest balance (other currencies listed apart,
  out of the totals), as Reports' Net worth. An account opens to the website's account page: balance
  and where it came from, money in and out this month, a card's limit, use and due day, the bank and
  what it needs, the register over the last 3 or 12 months with its running balance (entries after the
  latest balance marked *; an entry opens for editing), recurring rules and savings goals (each opens
  its goal sheet).
  **Add a balance** / **Update balance** on an open account types in what it holds (or for a card or
  loan what is owed) as of a day no later than today, as Settings → Accounts does; a second entry
  that day replaces the first. The ones typed in are listed under "Balances you entered", each with
  Delete; a bank's own readings can't be deleted.
  `GET /api/v1/net-worth`, `GET /api/v1/accounts/:id?months=` (now with `manualBalances`),
  `POST /api/v1/accounts/:id/balances`, `DELETE /api/v1/accounts/:id/balances/:balanceId`
  (`src/lib/api-v1/accounts.ts`, `balances.ts`, the website's `loadNetWorth`, `loadAccountPage` and
  `upsertBalanceSnapshot`). `src/screens/accounts/`, `src/app/balance.tsx`, `src/utils/accounts.ts`,
  `src/utils/balances.ts`
- Account settings (on servers that list `account-settings` in `/api/v1/me`): **+** on Accounts adds
  an account by name and type (in the home currency, Counts as savings from its type, as Settings →
  Accounts does). **Edit** on an account's page changes its name, type, currency (kept once it holds
  money in it) and **Counts as savings**, and a credit card's limit and payment due day (empty clears
  either); **Archive Account** asks first and is refused while a recurring rule, contribution or
  portfolio value uses it; **Restore Account** brings it back. Archived accounts are listed under
  Accounts → Archived. Deleting stays on the website. `POST /api/v1/accounts`,
  `PATCH /api/v1/accounts/:id` (`src/lib/api-v1/account-edits.ts`, `src/lib/account-edits.ts`), the
  account page's `settings`. `src/screens/accounts/edit.tsx`, `src/app/account-edit.tsx`,
  `src/utils/account-settings.ts`
- Investments (Accounts → Investments ›, or an investment account's page, on servers that list
  `investments` in `/api/v1/me`): the website's Investments card. **Room left** for each TFSA, RRSP
  and FHSA type held, this room year (an RRSP's is its deduction limit's), with where the figure came
  from and what went in and out; over the room shows what CRA charges. Tapping a row enters or changes
  the year's figure from CRA, or removes it. **Value and return**: each account's value with its
  money-weighted return this year and over 12 months, and All together. **Activity**: the newest
  contributions, withdrawals and portfolio values (each opens its sheet: account, amount or value,
  date, note; Save and Delete) and deposits into a registered account not yet counted toward room
  (**Count Toward Room**, once). The + menu adds a contribution or withdrawal, or a portfolio value;
  a contribution that would go over the year's room asks first (**Add Anyway**).
  `GET /api/v1/investments`, `POST /api/v1/investments/contributions` (409 until `overRoom`),
  `PATCH`/`DELETE /api/v1/investments/contributions/:id`, the same under `/values`,
  `POST /api/v1/investments/transfers/:id/count`, `PUT /api/v1/investments/room`,
  `DELETE /api/v1/investments/room/:id` (`src/lib/api-v1/investments.ts`, `src/lib/investment-edits.ts`).
  `src/screens/investments/`, `src/app/investment.tsx`, `src/utils/investments.ts`
- Banks (Settings → Bank connections, and Review's "Your banks"): each bank connection with what
  it needs, when it was last checked, and its accounts, each with a picker for the app account its
  transactions go to (same currency only, or Not synced). On the home server, once the server sets
  `APPLE_APP_ID` and the person has a passkey, **Connect a Bank** (with how much history to fetch)
  and each bank's Sign in again, Renew access or new-accounts button run in the app: Face ID
  confirms it's you, then Plaid Link opens full screen (`react-native-plaid-link-sdk`). A bank's own
  app or site sends the person back through `https://<server>/plaid/oauth`, a universal link the
  app ignores (`src/utils/system-path.ts`) because Link picks it up itself. Anywhere else the screen
  says why and links to the website. Disconnecting stays on the website. Syncing by hand, for
  servers whose background sweep is off: **Sync Now** on each bank runs whatever the schedule (as
  the website's Sync now), and the toolbar's sync button or pulling down checks every bank not
  checked in the last 15 minutes (as the Review tab does). A sync that finds a bank wants signing
  in again turns its card into that prompt, with the Sign in again button first; new rows offer
  "Review them". `GET /api/v1/banks`, `PUT /api/v1/banks/accounts/:id`, `POST /api/v1/banks/:id/sync`,
  `POST /api/v1/app/step-up/options`, `POST /api/v1/banks/link` and `/link/:id/complete`
  (`src/lib/api-v1/banks.ts`, `src/lib/app-bank-link.ts`, the website's `syncBank`, `linkBank`,
  `completeUpdate` and account mapping). `src/screens/banks.tsx`,
  `src/session/bank-link.ts`, `src/utils/banks.ts`
- Settings: who is signed in, the server, Open the website, Sign out (also revokes the token on
  the server), and **Require Face ID** (Touch ID or the passcode on phones without it): the app
  opens to a lock screen and locks again after 5 minutes in the background; turning it on or off
  asks iOS first; the setting belongs to the sign-in, so a new sign-in starts with it off.
  `src/screens/settings/index.tsx`, `src/session/app-lock.tsx`, `src/screens/locked.tsx`
- Alerts (Settings → Alerts): bill reminders, large or unusual charges and budget alerts by Apple
  push, once the server's admin has saved Apple's key. **Turn on alerts** asks iOS, then a switch
  per kind and **Hide amounts in alerts** (the alert says only what kind it is). Tapping an alert opens Bills and pay (bill reminders),
  Transactions (charges) or Budgets, after Face ID if the lock is on. The phone registers again at
  each launch, since Apple can change its token; signing out ends its alerts.
  `GET`/`PUT /api/v1/app/device/push`. `src/screens/settings/alerts.tsx`,
  `src/notifications/alerts.ts`, `src/utils/alerts.ts`
- When alerts come (Settings → When alerts come ›, on servers that list `alert-timing` in
  `/api/v1/me`): the website's Settings → Notifications timing, for email and phones alike. Bill
  reminders Off / Day before / 3 days / A week; charge alerts at or over an amount (empty for off,
  saved on leaving the field) and **Unusual for the merchant**; the email digest Off / Weekly /
  Monthly with **Send Me One Now**; and **Email budget alerts**. Each change saves at once and
  moves back with the server's reason under it if refused (a reminder or charge alert needs email
  or a phone taking it; the digest and budget emails need email, and stay off without it).
  `GET`/`PATCH /api/v1/alert-timing`, `POST /api/v1/alert-timing/digest-preview`
  (`src/lib/api-v1/alert-timing.ts`). `src/screens/settings/alert-timing.tsx`, `src/utils/alert-timing.ts`
- A token the server no longer accepts signs the phone out with a note on the sign-in screen
