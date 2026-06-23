export type StatBoxProps = {
  label: string;
  value: string;
  note?: string;
  /** Controls amount text color */
  valueVariant?: "income" | "expense" | "net-pos" | "net-neg" | "neutral";
};

export type CashFlowSummaryProps = {
  incomeCents: number;
  expenseCents: number;
  netCents: number;
  incomeNote?: string; /** e.g. "3-month average" */
};
