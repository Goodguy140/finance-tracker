/** Finance Tracker design tokens — CSS custom properties */
export declare const tokens: {
  /** #020617 — page background */
  bg: string;
  /** #0f172a — card / panel background */
  surface: string;
  /** #1e293b — default border */
  border: string;
  /** #334155 — input / button border */
  borderSubtle: string;
  /** #e2e8f0 — primary text */
  fg: string;
  /** #94a3b8 — secondary / meta text */
  fgMuted: string;
  /** #64748b — tertiary / placeholder */
  fgDim: string;
  /** #3b82f6 — primary action */
  blue: string;
  /** #60a5fa — hover / focus ring accent */
  blueHover: string;
  /** #93c5fd — links, inline emphasis */
  blueLink: string;
  /** #10b981 — income, healthy budget */
  emerald: string;
  /** #a7f3d0 — income amount text */
  emeraldText: string;
  /** #f59e0b — warning badge */
  amber: string;
  /** #fbbf24 — budget 80-100% progress bar */
  amberBar: string;
  /** #ef4444 — over-budget, critical */
  red: string;
  /** #fecaca — negative amount text */
  redText: string;
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

export declare function accountTypePillClass(type: AccountType): string;
