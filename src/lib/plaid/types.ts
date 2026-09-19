/**
 * The slice of Plaid's API this app actually reads.
 *
 * Hand-written rather than generated: the official SDK is an enormous OpenAPI client plus
 * axios, and `output: "standalone"` would carry that weight into the image twice. Only the
 * fields consumed anywhere in `src/lib/plaid` appear here — everything else Plaid sends is
 * ignored rather than modelled, which is also what keeps this resilient to Plaid adding
 * fields. Responses are read leniently: a missing optional is `undefined`, never a throw.
 */

export type PlaidApiAccountBalances = {
  /** Null for credit accounts Plaid cannot currently resolve; never assume a number. */
  current?: number | null;
  available?: number | null;
  iso_currency_code?: string | null;
  unofficial_currency_code?: string | null;
};

export type PlaidApiAccount = {
  account_id: string;
  name: string;
  official_name?: string | null;
  /** Last 2–4 digits. Display only — never an identifier. */
  mask?: string | null;
  type: string;
  subtype?: string | null;
  balances?: PlaidApiAccountBalances;
};

export type PlaidApiItem = {
  item_id: string;
  institution_id?: string | null;
  /** ISO 8601. Set for institutions that require periodic re-consent (notably the EU/UK). */
  consent_expiration_time?: string | null;
  error?: PlaidApiErrorPayload | null;
};

/** The error object Plaid returns in a response body. Distinct from the `PlaidApiError`
 *  *class* in client.ts, which is what gets thrown. */
export type PlaidApiErrorPayload = {
  error_type?: string | null;
  error_code?: string | null;
  error_message?: string | null;
  display_message?: string | null;
  request_id?: string | null;
};

/**
 * Plaid's own category taxonomy. `primary` is the coarse bucket this app maps from;
 * `detailed` is stored for display but never drives a decision.
 */
export type PlaidPersonalFinanceCategory = {
  primary?: string | null;
  detailed?: string | null;
  confidence_level?: string | null;
};

export type PlaidApiTransaction = {
  transaction_id: string;
  account_id: string;
  /**
   * POSITIVE means money left the account. This is the opposite of most people's
   * intuition and the single most important field to get right — see `ingest.ts`.
   */
  amount: number;
  iso_currency_code?: string | null;
  unofficial_currency_code?: string | null;
  /** `YYYY-MM-DD`, the transaction date. */
  date: string;
  /** `YYYY-MM-DD`, when it actually posted. Absent while still pending. */
  authorized_date?: string | null;
  datetime?: string | null;
  name: string;
  merchant_name?: string | null;
  pending: boolean;
  /**
   * When a pending transaction posts, Plaid issues a NEW transaction_id and points this
   * at the old one. Missing this is how you end up with every pending charge duplicated.
   */
  pending_transaction_id?: string | null;
  personal_finance_category?: PlaidPersonalFinanceCategory | null;
  payment_channel?: string | null;
};

/** One page of `/transactions/sync`. */
export type PlaidSyncPage = {
  added: PlaidApiTransaction[];
  modified: PlaidApiTransaction[];
  /** Only ever carries the id — the record itself is gone from Plaid's side. */
  removed: Array<{ transaction_id: string }>;
  next_cursor: string;
  has_more: boolean;
};

export type CreateLinkTokenInput = {
  /** Stable, opaque, and not an email: Plaid retains it. The app's user id. */
  clientUserId: string;
  clientName: string;
  countryCodes: string[];
  language?: string;
  /**
   * How much history to request, 1–730. Set ONCE when the item is created; it is not a
   * filter that can be re-applied later, which is why the window is enforced at ingest.
   */
  daysRequested?: number;
  /** Present only in update mode (re-authentication), where `products` must be omitted. */
  accessToken?: string;
  webhook?: string;
  redirectUri?: string;
};
