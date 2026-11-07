/** What the server's `/api/v1` routes answer, as far as the app reads them. Fields are only ever added. */

export type Me = {
  user: { id: string; email: string; displayName: string; timezone: string; countryCode: string; currency: string };
  device: { id: string };
  /** What the server takes beyond the first API (`rules`: `/api/v1/rules`). Absent from older servers. */
  features?: string[];
};

export type BudgetRow = {
  categoryId: string;
  categoryName: string;
  /** The month's limit, rollover included. */
  limitCents: number;
  monthlyLimitCents: number;
  /** Carried in by rollover: positive left over from earlier months, negative overspent. */
  rolloverCents: number;
  spentCents: number;
  percentUsed: number;
  /** Added in Phase 3; absent from older servers. */
  groupName?: string | null;
  rollover?: boolean;
};

export type YearlyBudgetRow = {
  categoryId: string;
  categoryName: string;
  groupName: string | null;
  limitCents: number;
  monthlyCents: number;
  setAsideCents: number;
  spentCents: number;
  /** Set aside less spent: positive is waiting in the fund, negative is spent ahead of it. */
  fundCents: number;
  leftForYearCents: number;
};

export type Budgets = {
  periodMonth: string;
  /** The person's own this month, which budgets are changed from. Absent from servers that take no changes. */
  currentMonth?: string;
  /** Each budget's category has a page (`GET /api/v1/categories/:id/trend`). Absent from older servers. */
  trends?: boolean;
  currency: string;
  budgets: BudgetRow[];
  totalLimitCents: number;
  totalSpentCents: number;
  yearly?: YearlyBudgetRow[];
};

export type SafeToSpend = {
  safeCents: number;
  perDayCents: number;
  daysLeft: number;
  incomeReceivedCents: number;
  spentCents: number;
  expectedIncomeCents: number;
  billsDueCents: number;
  budgetLeftCents: number;
  goalsCents: number;
};

export type UpcomingItem = {
  date: string;
  name: string;
  type: 'expense' | 'income';
  amountCents: number;
  overdue: boolean;
  planned: boolean;
};

export type Summary = {
  month: string;
  today: string;
  currency: string;
  safeToSpend: SafeToSpend;
  budgets: {
    count: number;
    totalLimitCents: number;
    totalSpentCents: number;
    watch: { categoryId: string; categoryName: string; limitCents: number; spentCents: number; percentUsed: number }[];
  };
  upcoming: { days: number; items: UpcomingItem[]; billsCents: number; incomeCents: number };
  waiting: { bankQueue: number; needsReview: number };
};

export type TransactionType = 'expense' | 'income' | 'transfer';

/** One entry as `GET /api/v1/transactions` lists it. Amounts are in the entry's own sign convention. */
export type Transaction = {
  id: string;
  type: TransactionType;
  date: string;
  postedDate: string | null;
  title: string | null;
  amountCents: number;
  currency: string | null;
  categoryId: string;
  categoryName: string;
  accountId: string | null;
  accountName: string | null;
  transferAccountId: string | null;
  note: string | null;
  tags: string[];
  splits: { categoryId: string; amountCents: number }[];
  owedToYouCents: number;
  verified: boolean;
  /** Added in Phase 3; absent from older servers. */
  transferAccountName?: string | null;
  needsReview?: boolean;
  creditCents?: number | null;
  attachmentCount?: number;
  /**
   * The other leg of a paired transfer. Sent by servers that let the phone change a transfer's
   * accounts; absent from older ones, which refuse it.
   */
  transferPeerId?: string | null;
};

/** A receipt kept with an entry, as `GET /api/v1/transactions/:id` lists it. */
export type Attachment = { id: string; fileName: string; contentType: string; sizeBytes: number };

/** One entry as `GET /api/v1/transactions/:id` answers: the list's fields and its receipts. */
/** Someone who owes part of an expense back. */
export type OwedShare = { id: string; name: string; amountCents: number; paidAt: string | null };

export type TransactionDetail = Transaction & {
  attachments?: Attachment[];
  /**
   * Who owes part of it back. Sent by servers that let the phone change splits and shares; an
   * older one leaves it out and refuses both.
   */
  owedShares?: OwedShare[];
};

/** `GET /api/v1/owed`: what people owe back, outstanding first in importance, newest expense first. */
export type OwedToYou = {
  currency: string;
  outstandingCents: number;
  items: {
    id: string;
    name: string;
    amountCents: number;
    currency: string;
    transactionId: string;
    expenseLabel: string;
    expenseDate: string;
    paidAt: string | null;
  }[];
};

export type TransactionPage = {
  transactions: Transaction[];
  nextCursor: string | null;
  /** The server takes `POST /api/v1/transactions/bulk`. Added after build 17. */
  bulkEdit?: boolean;
};

export type Category = { id: string; name: string; kind: 'expense' | 'income' | 'transfer' };
export type Account = { id: string; name: string; type: string; currency: string; archived: boolean };
export type Tag = { id: string; name: string; count: number };

/** What `GET /api/v1/quick-add` reads typed text as: the entry, and how saving it would book it. */
export type QuickAddPreview = {
  amountCents: number;
  title: string;
  dateYmd: string;
  categoryName: string;
  accountName: string | null;
  /** A rule's split, described, when the expense would be split. */
  split: string | null;
  /** Set when a "Mark as transfer" rule matches, so saving books a transfer. */
  transfer: { toAccountName: string | null } | null;
};

export type QuickAddAnswer = {
  preview: QuickAddPreview | null;
  /** The text as read, before rules rename it: what to post. */
  entry: { amountCents: number; title: string; dateYmd: string } | null;
};

/** What adding a bank row writes, as the person's rules shape it. */
export type QueueProposal = {
  title: string;
  note: string | null;
  tags: string[];
  /** A rule's split, described ("70% Groceries, 30% Household"). */
  split: string | null;
  reason: 'rule' | 'learned' | null;
};

/** A bank row waiting in the review queue: `GET /api/v1/review-queue`. */
export type QueueRow = {
  id: string;
  bank: string;
  heading: string;
  bankName: string;
  amountCents: number;
  direction: 'in' | 'out';
  date: string;
  account: string;
  pending: boolean;
  /** Offered as a transfer between the person's own accounts. */
  isTransfer: boolean;
  /** What it is booked as when it is not a transfer; its categories are `categories[type]`. */
  type: 'expense' | 'income';
  suggestedCategoryId: string | null;
  asTransfer: QueueProposal;
  asNonTransfer: QueueProposal;
  match: {
    transaction: { id: string; title: string; amountCents: number; date: string };
    tier: 'high' | 'low';
    reasons: string[];
  } | null;
  transferPair: { id: string; heading: string; account: string; date: string; outflow: boolean } | null;
};

/** The bank's later change to a row already added. */
export type QueueRevision = {
  id: string;
  heading: string;
  bank: string;
  approvedAmountCents: number;
  bankAmountCents: number;
  date: string;
};

export type LinkedBank = {
  id: string;
  name: string;
  lastSyncedAt: string | null;
  attention: { kind: string; message: string; actionLabel: string } | null;
};

export type ReviewQueue = {
  total: number;
  rows: QueueRow[];
  revisions: QueueRevision[];
  categories: { expense: { id: string; name: string }[]; income: { id: string; name: string }[] };
  banks: LinkedBank[];
};

export type AlertKind = 'billReminders' | 'chargeAlerts' | 'budgetAlerts';

/** This phone's alert settings on the server: `GET`/`PUT /api/v1/app/device/push`. */
export type AlertRegistration = {
  environment: 'production' | 'development';
  alerts: Record<AlertKind, boolean>;
  hideAmounts: boolean;
};

export type AlertStatus = {
  /** The server has Apple's push key, so it can send to the app at all. */
  available: boolean;
  registration: AlertRegistration | null;
};

/** A recurring bill, pay or transfer as `GET /api/v1/recurring` lists it, with the occurrence it waits on. */
export type RecurringRule = {
  id: string;
  name: string;
  type: TransactionType;
  amountCents: number;
  currency: string;
  cadence: 'weekly' | 'biweekly' | 'semi_monthly' | 'monthly' | 'quarterly' | 'yearly' | 'biennial';
  date: string;
  status: 'overdue' | 'due' | 'upcoming';
  account: string;
  toAccount: string | null;
  category: string | null;
  autoPost: boolean;
  endDate: string | null;
  /** What the rule sheet needs to change it. Added after build 17, with `paused` on the list. */
  accountId?: string;
  transferAccountId?: string | null;
  categoryId?: string;
  firstDay?: number | null;
  secondDay?: number | null;
  beforeWeekend?: boolean;
  note?: string | null;
  cancelUrl?: string | null;
  decideBy?: string | null;
  enabled?: boolean;
  cancelledAt?: string | null;
};

export type RecurringList = {
  today: string;
  rules: RecurringRule[];
  /** Rules turned off or cancelled, by name. Absent from a server that takes no rule changes. */
  paused?: RecurringRule[];
};

export type InsightSection = 'ahead' | 'gap' | 'recurring' | 'habit' | 'saving' | 'improvement' | 'good';

/** One insight as `GET /api/v1/insights` lists it: what the website's Insights page shows. */
export type Insight = {
  key: string;
  section: InsightSection;
  severity: 'high' | 'medium' | 'low';
  title: string;
  body: string;
  monthlyCents: number | null;
  annualCents: number | null;
  savingCents: number | null;
  evidence: { id: string; date: string; title: string | null; amountCents: number; type: TransactionType }[];
  /** The page of the website its button leads to (a path on the server), when it has one. */
  website: { path: string; label: string } | null;
  /** Only on a hidden one: snoozed until this day, or null when dismissed for good. */
  hiddenUntil?: string | null;
};

export type InsightList = { currency: string; snoozeDays: number; insights: Insight[]; hidden: Insight[] };

export type ScoreBand = 'Strong' | 'Good' | 'Fair' | 'Needs work' | 'At risk';

/** The financial score as `GET /api/v1/score` gives it. */
export type FinancialScore =
  | { status: 'insufficient'; currency: string; reason: string }
  | {
      status: 'scored';
      currency: string;
      score: number;
      band: ScoreBand;
      months: string[];
      change: { fromMonth: string; fromScore: number; mover: { label: string; delta: number } | null } | null;
      pillars: { id: string; label: string; score: number | null; band: ScoreBand | null; weight: number; note: string | null }[];
      factors: {
        id: string;
        pillar: string;
        label: string;
        score: number;
        band: ScoreBand;
        weight: number;
        detail: string;
        suggestion: string | null;
      }[];
      suggestions: string[];
      omitted: { label: string; reason: string }[];
      otherCurrencyAccounts: { name: string; currency: string }[];
      emergencyTargetMonths: number;
    };

export type AccountBalance = { cents: number; date: string; source: 'bank' | 'manual' | 'portfolio' };

/** `GET /api/v1/net-worth`: every open account with its balance, and what they add up to. */
export type NetWorth = {
  currency: string;
  assetsCents: number;
  liabilitiesCents: number;
  netCents: number;
  points: { ym: string; label: string; netCents: number }[];
  accounts: {
    id: string;
    name: string;
    type: string;
    typeLabel: string;
    currency: string;
    liability: boolean;
    counted: boolean;
    balance: AccountBalance | null;
  }[];
};

export type NetWorthAccount = NetWorth['accounts'][number];

/** `GET /api/v1/accounts/:id`: the website's account page. */
export type AccountPage = {
  account: { id: string; name: string; type: string; typeLabel: string; currency: string; archived: boolean };
  liability: boolean;
  balance: AccountBalance | null;
  history: { ym: string; label: string; cents: number }[];
  thisMonth: { inCents: number; outCents: number };
  card: {
    limitCents: number | null;
    utilization: { pct: number; high: boolean } | null;
    highPct: number;
    dueDay: string | null;
  } | null;
  months: number;
  register: {
    id: string;
    date: string;
    title: string;
    type: TransactionType;
    inCents: number;
    balanceCents: number | null;
    afterReading: boolean;
  }[];
  bank: { institutionName: string; lastSyncedAt: string | null; problem: string | null } | null;
  waitingInQueue: number;
  rules: {
    id: string;
    name: string;
    type: string;
    amountCents: number;
    cadence: string;
    date: string;
    transfer: { otherName: string; into: boolean } | null;
  }[];
  goals: { id: string; name: string; targetCents: number; currency: string; percent: number }[];
  /**
   * Balances the person typed in, newest first, which the phone can delete. Added after build 17;
   * an older server leaves it out and cannot take a balance from the phone either.
   */
  manualBalances?: { id: string; date: string; cents: number }[];
};

export type RegisterRow = AccountPage['register'][number];

/** Which earlier spending the cumulative chart draws beside this month's. */
export type SpendingComparison = 'none' | 'last-month' | 'three-month-average';

/**
 * `GET /api/v1/spending`: the website's Cumulative spending and Spending by category cards for one
 * month. Added after build 17; an older server answers 404 and Home leaves the charts out.
 */
export type Spending = {
  month: string;
  today: string;
  currency: string;
  /** The choices this answer was built with: the phone's own, or the website card's. */
  compareWith: SpendingComparison;
  showSavings: boolean;
  cumulative: {
    /** One per day of the month. */
    days: {
      day: number;
      spentCents: number;
      /** Running total; null for days still to come. */
      totalCents: number | null;
      /** Where the budgets (or the last 3 months) say the total would be by then; null with no expected line. */
      expectedCents: number | null;
      comparisonCents: number | null;
    }[];
    totalCents: number;
    expectedBasis: 'budgets' | 'average' | null;
    /** Total less expected, today: positive is over. */
    expectedGapCents: number | null;
    /** Total less the comparison, today: positive is more. Null with nothing to compare with. */
    comparisonGapCents: number | null;
  };
  categories: {
    /** Net spending in the month across every category (Savings not included). */
    totalCents: number;
    /** Slices are category groups (once the person has any) rather than categories. */
    grouped: boolean;
    /** Biggest first; "Other categories" and then Savings last. A negative slice is refunds outweighing spending. */
    /** `categoryId` is on a single category's slice, from servers that have its page. */
    slices: { name: string; cents: number; color: string; kind: 'category' | 'other' | 'savings'; categoryId?: string }[];
    /** Net moved into savings accounts, and how many accounts count as savings; null when the slice is off. */
    savings: { cents: number; accounts: number } | null;
  };
};

/** A one-off plan: a car repair in March, a tax refund in April. */
export type Plan = {
  id: string;
  type: 'expense' | 'income';
  name: string;
  amountCents: number;
  currency: string;
  date: string;
  accountId: string;
  accountName: string;
  categoryId: string;
  categoryName: string;
  note: string | null;
  /** Its date has passed: the website asks "Did this happen?". */
  pastDue: boolean;
};

/** `GET /api/v1/planned`. Added after build 17; an older server answers 404. */
export type PlanList = { today: string; plans: Plan[] };

/** `GET /api/v1/month-review`: the website's monthly review. Added after build 17; an older server answers 404. */
export type MonthReview = {
  month: string;
  currentMonth: string;
  running: boolean;
  currency: string;
  incomeCents: number;
  spendingCents: number;
  netCents: number;
  previousIncomeCents: number;
  previousSpendingCents: number;
  transactionCount: number;
  categories: { categoryName: string; cents: number; previousCents: number }[];
  changes: { categoryName: string; cents: number; previousCents: number }[];
  biggest: { date: string; title: string; cents: number }[];
  budgets: { categoryName: string; spentCents: number; limitCents: number; rollsOver: boolean }[];
  budgetsKept: number;
  bankRowsWaiting: number;
  entriesNeedingReview: number;
  score: number | null;
  previousScore: number | null;
  closedOn: string | null;
};

/** `GET /api/v1/categories/:id/trend`: the website's category page. Added after build 17; an older server answers 404. */
export type CategoryTrend = {
  categoryId: string;
  name: string;
  kind: 'expense' | 'income';
  groupName: string | null;
  currency: string;
  /** Oldest first, up to 24 months, this one last. Empty when nothing was filed in that time. */
  months: { month: string; label: string; cents: number; budgetCents: number | null }[];
  averageCents: number | null;
  averageMonths: number;
  thisMonth: { cents: number; paceCents: number | null; budgetCents: number | null } | null;
  payees: { key: string; label: string; cents: number; count: number }[];
  biggest: { id: string; date: string; title: string; cents: number; split: boolean }[];
};

/** `GET /api/v1/merchants?key=`: the website's payee page. Added after build 17; an older server answers 404. */
export type MerchantActivity = {
  key: string;
  label: string;
  currency: string;
  firstDate: string;
  lastDate: string;
  spentCents: number;
  receivedCents: number;
  count: number;
  averageCents: number | null;
  months: { month: string; label: string; spentCents: number; receivedCents: number }[];
  categories: { categoryName: string; spentCents: number }[];
  /** Newest first; at most 200, while `count` counts them all. */
  transactions: {
    id: string;
    date: string;
    title: string;
    type: 'expense' | 'income';
    amountCents: number;
    /** Null for a split entry. */
    categoryName: string | null;
    split: boolean;
  }[];
};

/** `POST /api/v1/rules`: the rule made, and how many past entries applying it would change. */
export type MadeRule = { id: string; matches: number };

/** `GET /api/v1/rules/suggestions`: learned Title → Category combos no rule decides yet, newest first. */
export type RuleSuggestions = { total: number; suggestions: { title: string; categoryId: string; categoryName: string }[] };

export type GoalStatus = 'reached' | 'overdue' | 'on-track' | 'behind' | 'needs' | 'open' | 'no-balance';

/** One goal from `GET /api/v1/goals`, with the Savings goals card's figures. */
export type SavingsGoal = {
  id: string;
  name: string;
  targetCents: number;
  targetDate: string | null;
  /** The account whose balance it follows; null when it is tracked by hand. */
  account: { id: string; name: string; archived: boolean } | null;
  currency: string;
  manualSavedCents: number;
  /** Null with a linked account that has no balance yet. */
  savedCents: number | null;
  remainingCents: number;
  percent: number;
  status: GoalStatus;
  monthsLeft: number | null;
  monthlyNeededCents: number | null;
  monthlyPaceCents: number | null;
  monthlyTransferCents: number | null;
  projectedDate: string | null;
  paceSource: 'balance' | 'transfers' | null;
};

/** `GET /api/v1/goals`. Added after build 17; an older server answers 404. */
export type SavingsGoals = {
  today: string;
  accounts: { id: string; name: string; type: string }[];
  goals: SavingsGoal[];
};
