import { AccountType } from "@prisma/client";

/** User-facing labels for `AccountType` (never show raw enum strings in UI). */
export const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  CHEQUING: "Chequing",
  SAVINGS: "Savings",
  CREDIT_CARD: "Credit card",
  TFSA: "TFSA",
  RRSP: "RRSP",
  FHSA: "FHSA",
  NON_REGISTERED: "Non-registered",
  CASH: "Cash",
  LOAN: "Loan or mortgage",
  PROPERTY: "Property",
};

/** Stable order for account-type `<select>` options. */
export const ACCOUNT_TYPE_ORDER: AccountType[] = [
  AccountType.CHEQUING,
  AccountType.SAVINGS,
  AccountType.CREDIT_CARD,
  AccountType.TFSA,
  AccountType.RRSP,
  AccountType.FHSA,
  AccountType.NON_REGISTERED,
  AccountType.CASH,
  AccountType.LOAN,
  AccountType.PROPERTY,
];

export function formatAccountTypeLabel(accountType: string): string {
  const mapped = ACCOUNT_TYPE_LABELS[accountType as AccountType];
  if (mapped) return mapped;
  return accountType
    .split("_")
    .map((w) => w.charAt(0) + w.slice(1).toLowerCase())
    .join(" ");
}

/** Stored on transactions when an account is removed (human-readable type). */
export function formatAccountDetachedLabel(accountName: string, accountType: string): string {
  return `${accountName} (${formatAccountTypeLabel(accountType)})`;
}
