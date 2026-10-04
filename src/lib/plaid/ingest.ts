import { TransactionType } from "@prisma/client";
import { dateFromYmd } from "@/lib/date-only";
import { isCentsInRange, toCents } from "@/lib/money";
import { titleCaseMerchant } from "@/lib/plaid/merchant-text";
import type { PlaidApiTransaction } from "@/lib/plaid/types";

/**
 * Turning a Plaid transaction into this app's semantics.
 *
 * Plaid's sign convention is the opposite of most people's intuition: a POSITIVE `amount`
 * means money left the account. Getting this backwards would invert every row, so it is
 * the one thing in the feature worth reading twice.
 */

export type PlaidAmountMapping =
  | { kind: "expense"; type: TransactionType; amountCents: number }
  | { kind: "income"; type: TransactionType; amountCents: number }
  | { kind: "transfer"; type: TransactionType; amountCents: number }
  | { kind: "skip"; reason: "zero" | "out_of_range" };

/** Plaid's coarse categories that genuinely mean money arriving. */
const INCOME_PRIMARIES = new Set(["INCOME"]);

/**
 * Plaid's categories for money moving between accounts. A credit-card payment is filed
 * under LOAN_PAYMENTS, but it is the same thing seen from the other side: the purchases it
 * pays off were already counted when they were charged.
 *
 * The other loan payments (mortgage, car, student loan) stay expenses. This app has no
 * loan accounts, so that money leaves everything it tracks, and counting it as a transfer
 * would make it disappear from spending altogether.
 *
 * Only ever a suggestion, like the category: the review queue lets the user book any row
 * as a transfer or not before it reaches the log.
 */
const TRANSFER_PRIMARIES = new Set(["TRANSFER_IN", "TRANSFER_OUT"]);
const TRANSFER_DETAILED = new Set(["LOAN_PAYMENTS_CREDIT_CARD_PAYMENT"]);

export function isPlaidTransfer(pfcPrimary: string | null | undefined, pfcDetailed: string | null | undefined) {
  const primary = (pfcPrimary ?? "").trim().toUpperCase();
  const detailed = (pfcDetailed ?? "").trim().toUpperCase();
  return TRANSFER_PRIMARIES.has(primary) || TRANSFER_DETAILED.has(detailed);
}

/**
 * Maps a Plaid amount onto a transaction type and a signed cents value.
 *
 * The non-obvious case is a negative amount that is *not* income — a merchant refund.
 * Booking that as INCOME would be wrong twice over: it inflates reported income, and it
 * leaves the original purchase uncorrected in its category, so budgets stay wrong. This
 * app already models it properly: `nonZeroExpenseAmount` in validation.ts tells users to
 * "use a negative value for credits (e.g. refunds) shown on statements", and `AmountPill`
 * renders a negative expense as a green credit. So a refund is a NEGATIVE EXPENSE in the
 * category the spend hit, and Plaid's convention maps onto that cleanly.
 */
export function mapPlaidAmount(input: {
  amount: number;
  pfcPrimary: string | null | undefined;
  pfcDetailed?: string | null | undefined;
}): PlaidAmountMapping {
  if (!Number.isFinite(input.amount) || input.amount === 0) {
    // Plaid emits $0 rows for authorisation holds; they are not transactions.
    return { kind: "skip", reason: "zero" };
  }

  const cents = toCents(Math.abs(input.amount));
  if (!isCentsInRange(cents)) {
    // Every money column is a signed 32-bit Int. Writing past that is a raw database
    // error, so it is refused here rather than surfacing from Prisma mid-sync.
    return { kind: "skip", reason: "out_of_range" };
  }

  if (isPlaidTransfer(input.pfcPrimary, input.pfcDetailed)) {
    // Plaid's sign is already the transfer's: positive left this account, negative arrived.
    return { kind: "transfer", type: TransactionType.TRANSFER, amountCents: input.amount > 0 ? cents : -cents };
  }

  if (input.amount > 0) {
    return { kind: "expense", type: TransactionType.EXPENSE, amountCents: cents };
  }

  const primary = (input.pfcPrimary ?? "").trim().toUpperCase();
  if (INCOME_PRIMARIES.has(primary)) {
    return { kind: "income", type: TransactionType.INCOME, amountCents: cents };
  }

  // Money in, but not income: a refund, chargeback or reward. Negative expense.
  return { kind: "expense", type: TransactionType.EXPENSE, amountCents: -cents };
}

/**
 * The name to show for a staged row, and to write as the title when it is committed.
 *
 * Plaid's `merchant_name` is already a clean trade name when it resolves one, so it is used
 * as sent. Its absence is what needs work: `name` is the raw bank description ("SQ *BLUE
 * BOTTLE #412 TORONTO ON"), which used to reach the review queue and `Transaction.title`
 * verbatim. The raw values stay on the staged row either way — this only decides what a
 * person reads.
 */
export function resolveDisplayName(
  name: string | null | undefined,
  merchantName: string | null | undefined,
): string {
  const merchant = merchantName?.trim();
  if (merchant) return merchant;

  const raw = name?.trim() ?? "";
  // Cleanup can legitimately consume everything ("#### ****"); showing nothing would be
  // worse than showing the description the bank actually sent.
  return titleCaseMerchant(raw) || raw;
}

export type NormalizedPlaidTransaction = {
  plaidTransactionId: string;
  plaidAccountId: string;
  pendingPlaidTransactionId: string | null;
  isPending: boolean;
  name: string;
  merchantName: string | null;
  amountCents: number;
  type: TransactionType;
  currency: string | null;
  date: Date;
  postedDate: Date | null;
  pfcPrimary: string | null;
  pfcDetailed: string | null;
};

export type NormalizeResult =
  | { ok: true; value: NormalizedPlaidTransaction }
  | { ok: false; reason: "zero" | "out_of_range" | "before_cutoff" | "unusable" };

/**
 * Normalises one Plaid transaction, or explains why it was dropped.
 *
 * `cutoff` enforces the history window the user chose. It has to happen here because
 * /transactions/sync cannot be asked for a date range — it returns everything from the
 * cursor onward, so the filter is applied as rows arrive.
 */
export function normalizePlaidTransaction(
  row: PlaidApiTransaction,
  options: { cutoff: Date | null },
): NormalizeResult {
  if (!row?.transaction_id || !row.account_id || typeof row.date !== "string") {
    return { ok: false, reason: "unusable" };
  }

  const date = dateFromYmd(row.date);
  if (Number.isNaN(date.getTime())) return { ok: false, reason: "unusable" };
  if (options.cutoff && date.getTime() < options.cutoff.getTime()) {
    return { ok: false, reason: "before_cutoff" };
  }

  const pfcPrimary = row.personal_finance_category?.primary ?? null;
  const pfcDetailed = row.personal_finance_category?.detailed ?? null;
  const mapped = mapPlaidAmount({ amount: row.amount, pfcPrimary, pfcDetailed });
  if (mapped.kind === "skip") return { ok: false, reason: mapped.reason };

  // `authorized_date` is when the purchase actually happened; `date` is when it posted or,
  // while pending, the expected date. Both are kept — the matcher tries either against a
  // hand-entered row, because people date a purchase from when they made it.
  const postedDate =
    typeof row.authorized_date === "string" && row.authorized_date
      ? dateFromYmd(row.authorized_date)
      : null;

  return {
    ok: true,
    value: {
      plaidTransactionId: row.transaction_id,
      plaidAccountId: row.account_id,
      pendingPlaidTransactionId: row.pending_transaction_id ?? null,
      isPending: Boolean(row.pending),
      name: row.name ?? "",
      merchantName: row.merchant_name ?? null,
      amountCents: mapped.amountCents,
      type: mapped.type,
      // unofficial_currency_code covers crypto and a few non-ISO cases; neither is
      // guaranteed present, and the app has no FX layer, so this is recorded rather
      // than acted on. Mapping refuses a currency mismatch at the account level.
      currency: row.iso_currency_code ?? row.unofficial_currency_code ?? null,
      date,
      postedDate: postedDate && !Number.isNaN(postedDate.getTime()) ? postedDate : null,
      pfcPrimary,
      pfcDetailed,
    },
  };
}
