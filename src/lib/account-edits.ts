import { AccountType, type PrismaClient } from "@prisma/client";
import { currencyChangeRefusal, loadAccountUsage } from "@/lib/account-currency-guard";
import { AUDIT_ACTIONS, recordAuditLog } from "@/lib/audit-log";
import { homeCurrencyOf } from "@/lib/home-currency";
import { MAX_AMOUNT_CENTS } from "@/lib/money";
import { defaultCountsAsSavings } from "@/lib/savings-transfers";

/**
 * Adding, changing and archiving an account, and a card's limit and due day, shared by
 * Settings → Accounts (`src/app/actions/accounts.ts`, `debt.ts`) and the phone
 * (`/api/v1/accounts`), so an account saves with the same checks from both.
 */

export class AccountEditError extends Error {
  constructor(
    message: string,
    readonly notFound = false,
  ) {
    super(message);
    this.name = "AccountEditError";
  }
}

type Db = PrismaClient;

export type AccountDetails = { name: string; type: AccountType; currency: string; countsAsSavings: boolean };

/**
 * A new account in the user's home currency, counted as savings when its type usually is. The
 * schema's CAD default is not used: it would move a US or Japanese user's new account out of
 * their home-currency totals.
 */
export async function createAccount(
  db: Db,
  user: { id: string; countryCode: string | null },
  input: { name: string; type: AccountType },
  headers?: Headers,
): Promise<string> {
  const created = await db.account.create({
    data: {
      userId: user.id,
      name: input.name,
      type: input.type,
      countsAsSavings: defaultCountsAsSavings(input.type),
      countryCode: user.countryCode ?? undefined,
      currency: homeCurrencyOf(user.countryCode),
      archived: false,
    },
    select: { id: true },
  });
  await recordAuditLog(db, {
    userId: user.id,
    action: AUDIT_ACTIONS.financial_account_created,
    targetType: "Account",
    targetId: created.id,
    headers,
  });
  return created.id;
}

/** Name, type, currency and Counts as savings. The currency stays put once the account holds money in it. */
export async function updateAccount(db: Db, userId: string, accountId: string, details: AccountDetails): Promise<void> {
  const existing = await db.account.findFirst({ where: { id: accountId, userId }, select: { name: true, currency: true } });
  if (!existing) throw new AccountEditError("Account not found.", true);
  if (existing.currency !== details.currency) {
    const refusal = currencyChangeRefusal(existing, details.currency, await loadAccountUsage(db, userId, accountId));
    if (refusal) throw new AccountEditError(refusal);
  }
  await db.account.update({
    where: { id: accountId },
    data: { name: details.name, type: details.type, currency: details.currency, countsAsSavings: details.countsAsSavings },
  });
}

/**
 * Archives an account (hidden from pickers, its history kept) or restores it. An account a
 * recurring rule, a contribution or a portfolio value still uses can't be archived, and one that
 * was the default for new expenses stops being it.
 */
export async function setAccountArchived(db: Db, userId: string, accountId: string, archived: boolean, headers?: Headers): Promise<void> {
  if (archived) {
    const [rules, flows, snapshots] = await Promise.all([
      db.recurringTransaction.count({ where: { userId, accountId } }),
      db.investmentFlow.count({ where: { userId, accountId } }),
      db.portfolioSnapshot.count({ where: { userId, accountId } }),
    ]);
    if (rules + flows + snapshots > 0) {
      throw new AccountEditError(
        "Cannot archive while this account is used by a recurring transaction, investment flow, or portfolio snapshot. Reassign or remove those first.",
      );
    }
  }
  const { count } = await db.account.updateMany({ where: { id: accountId, userId }, data: { archived } });
  if (count === 0) throw new AccountEditError("Account not found.", true);
  if (archived) {
    await db.user.updateMany({ where: { id: userId, defaultExpenseAccountId: accountId }, data: { defaultExpenseAccountId: null } });
  }
  await recordAuditLog(db, {
    userId,
    action: archived ? AUDIT_ACTIONS.financial_account_archived : AUDIT_ACTIONS.financial_account_unarchived,
    targetType: "Account",
    targetId: accountId,
    metadata: { archived },
    headers,
  });
}

/** A credit card's limit and the day of the month its payment is due; null clears either. */
export async function setCardTerms(
  db: Db,
  userId: string,
  accountId: string,
  terms: { creditLimitCents: number | null; paymentDueDay: number | null },
): Promise<void> {
  const account = await db.account.findFirst({ where: { id: accountId, userId }, select: { id: true, type: true, paymentDueDay: true } });
  if (!account || account.type !== AccountType.CREDIT_CARD) throw new AccountEditError("Only credit cards have a limit and due day.");
  const { creditLimitCents, paymentDueDay } = terms;
  if (creditLimitCents !== null && (!Number.isInteger(creditLimitCents) || creditLimitCents <= 0 || creditLimitCents > MAX_AMOUNT_CENTS)) {
    throw new AccountEditError("Enter the credit limit as an amount, like 5000.");
  }
  if (paymentDueDay !== null && (!Number.isInteger(paymentDueDay) || paymentDueDay < 1 || paymentDueDay > 31)) {
    throw new AccountEditError("Enter the due day as a day of the month, 1 to 31.");
  }
  await db.account.update({
    where: { id: account.id },
    data: {
      creditLimitCents,
      paymentDueDay,
      // A new due day is a new schedule: its first date has not been reminded.
      ...(paymentDueDay !== account.paymentDueDay ? { paymentRemindedFor: null } : {}),
    },
  });
}
