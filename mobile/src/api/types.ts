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

export type TransactionPage = { transactions: Transaction[]; nextCursor: string | null };

export type Category = { id: string; name: string; kind: 'expense' | 'income' | 'transfer' };
export type Account = { id: string; name: string; type: string; currency: string; archived: boolean };
export type Tag = { id: string; name: string; count: number };
