export type MetaChipProps = {
  label: string;
  children: React.ReactNode;
};

export type AccountType =
  | "CHEQUING"
  | "SAVINGS"
  | "CREDIT_CARD"
  | "TFSA"
  | "RRSP"
  | "FHSA"
  | "NON_REGISTERED"
  | "CASH";

export type AccountTypePillProps = {
  accountType: AccountType;
};

export type NotificationBadgeProps = {
  count: number;
  max?: number; /** defaults to 9 — shows "9+" above this */
};

export type StatusDotVariant = "ok" | "warning" | "critical" | "disabled";
