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
