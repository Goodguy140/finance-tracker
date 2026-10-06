/**
 * Shared-subscription credit math.
 *
 * When members of a shared subscription pay their portion, those portions are recorded
 * as credits on the subscription's posted expense transaction, reducing its net cost.
 * Credits are always recomputed from the full set of paid members for an occurrence so
 * toggling "paid" on and off is idempotent and fully reversible. The output mirrors the
 * receipt-breakdown shape produced by {@link parseExpenseAmountFromForm} so the expense log
 * renders subscription credits with no UI changes.
 */

export type SubscriptionCreditResult = {
  amountCents: number;
  preCreditCents: number | null;
  creditCents: number | null;
  creditBreakdownJson: string | null;
};

/**
 * Recomputes a subscription transaction's amount/credit fields from its gross bill and the
 * cents each currently-paid member contributes.
 *
 * @throws if the paid shares exceed the gross bill (net would be negative). A net of exactly
 *   zero is allowed (a fully reimbursed bill).
 */
export function computeSubscriptionCredit(input: {
  grossCents: number;
  paidShareCents: number[];
}): SubscriptionCreditResult {
  const shares = input.paidShareCents.filter((cents) => Number.isFinite(cents) && cents > 0);
  const creditCents = shares.reduce((sum, cents) => sum + cents, 0);

  if (creditCents === 0) {
    return {
      amountCents: input.grossCents,
      preCreditCents: null,
      creditCents: null,
      creditBreakdownJson: null,
    };
  }

  const netCents = input.grossCents - creditCents;
  if (netCents < 0) {
    throw new Error("Paid shares exceed the subscription's billed amount. Lower a share before marking it paid.");
  }

  return {
    amountCents: netCents,
    preCreditCents: input.grossCents,
    creditCents,
    creditBreakdownJson: JSON.stringify(shares),
  };
}

/** The gross (pre-credit) bill for a posted transaction, whether or not credits are applied. */
export function grossCentsForTransaction(txn: { amountCents: number; preCreditCents: number | null }): number {
  return txn.preCreditCents ?? txn.amountCents;
}

/** Minimal Prisma client surface needed to recompute credits (works with `prisma` or a `$transaction` client). */
type SubscriptionCreditTxClient = {
  subscriptionShareStatus: {
    findMany: (args: {
      where: { userId: string; recurringTransactionId: string; expectedDate: Date; paid: boolean };
      include: { member: { select: { shareCents: true } } };
      orderBy: { id: "asc" };
    }) => Promise<Array<{ member: { shareCents: number } }>>;
  };
  transaction: {
    findFirst: (args: {
      where: { userId: string; recurringTransactionId: string; recurringExpectedDate: Date };
      select: { id: true; amountCents: true; preCreditCents: true; owedShares: { select: { id: true } } };
    }) => Promise<{
      id: string;
      amountCents: number;
      preCreditCents: number | null;
      /** Absent from test doubles that predate one-off owed shares. */
      owedShares?: Array<{ id: string }>;
    } | null>;
    update: (args: { where: { id: string }; data: SubscriptionCreditResult }) => Promise<unknown>;
  };
};

/**
 * Recomputes and persists the subscription credits on the posted expense transaction for a
 * given billing occurrence. No-op if the occurrence has not been posted yet — credits are then
 * applied when the subscription is posted.
 */
export async function recomputeSubscriptionTransactionCredits(
  tx: SubscriptionCreditTxClient,
  params: { userId: string; recurringTransactionId: string; expectedDate: Date },
): Promise<void> {
  const txn = await tx.transaction.findFirst({
    where: {
      userId: params.userId,
      recurringTransactionId: params.recurringTransactionId,
      recurringExpectedDate: params.expectedDate,
    },
    select: { id: true, amountCents: true, preCreditCents: true, owedShares: { select: { id: true } } },
  });
  if (!txn) return;
  // Shares owed on the expense itself were already taken out of its amount; crediting the
  // members on top would rebuild the amount from the wrong gross.
  if ((txn.owedShares?.length ?? 0) > 0) {
    throw new Error("This bill already has amounts owed to you on it. Remove them from the expense first.");
  }

  const statuses = await tx.subscriptionShareStatus.findMany({
    where: {
      userId: params.userId,
      recurringTransactionId: params.recurringTransactionId,
      expectedDate: params.expectedDate,
      paid: true,
    },
    include: { member: { select: { shareCents: true } } },
    orderBy: { id: "asc" },
  });

  const result = computeSubscriptionCredit({
    grossCents: grossCentsForTransaction(txn),
    paidShareCents: statuses.map((status) => status.member.shareCents),
  });

  await tx.transaction.update({ where: { id: txn.id }, data: result });
}
