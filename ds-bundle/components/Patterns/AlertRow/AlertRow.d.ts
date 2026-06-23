export type AlertSeverity = "critical" | "warning" | "pace" | "neutral";

export type AlertRowProps = {
  severity: AlertSeverity;
  message: string;
  /** e.g. "$150.00 / $100.00" */
  detail?: string;
  onDismiss?: () => void;
  onRestore?: () => void;
};

export type AlertsPanelProps = {
  warnings: AlertRowProps[];
  paceTrends: Array<{ message: string }>;
  momTrends: Array<{ message: string }>;
  periodLabel: string;
  insightCount: number;
};
