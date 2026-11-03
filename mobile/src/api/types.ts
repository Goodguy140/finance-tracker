/** What the server's `/api/v1` routes answer, as far as the app reads them. Fields are only ever added. */

export type Me = {
  user: { id: string; email: string; displayName: string; timezone: string; countryCode: string; currency: string };
  device: { id: string };
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
};

/** A receipt kept with an entry, as `GET /api/v1/transactions/:id` lists it. */
export type Attachment = { id: string; fileName: string; contentType: string; sizeBytes: number };

/** One entry as `GET /api/v1/transactions/:id` answers: the list's fields and its receipts. */
export type TransactionDetail = Transaction & { attachments?: Attachment[] };

export type TransactionPage = { transactions: Transaction[]; nextCursor: string | null };

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
};

export type RecurringList = { today: string; rules: RecurringRule[] };

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
