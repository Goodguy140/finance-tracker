export type PanelProps = {
  children: React.ReactNode;
  className?: string;
  padding?: "default" | "compact";
};

export type PanelHeaderProps = {
  title: string;
  subtitle?: string;
  count?: string;
  amount?: string;
  amountVariant?: "income" | "expense" | "neutral";
  action?: React.ReactNode;
};
