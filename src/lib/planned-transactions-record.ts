import { TransactionType, type Prisma, type PrismaClient } from "@prisma/client";
import { dateFromYmd } from "@/lib/date-only";

/**
 * "Yes, add it" on a one-off plan past its date, shared by the website's Upcoming bills and the
 * phone: the plan is recorded as an entry in the log, on its own date unless another is given, and
 * marked done by linking it. The link is claimed in the same transaction, so a double submit adds
 * one entry, not two.
 */

export class PlanError extends Error {
  constructor(
    message: string,
    readonly notFound = false,
  ) {
    super(message);
    this.name = "PlanError";
  }
}

type Db = PrismaClient | Prisma.TransactionClient;

/** The user's plan that has not happened yet. @throws PlanError */
export async function findOpenPlan(db: Db, userId: string, planId: string) {
  const plan = await db.plannedTransaction.findFirst({ where: { id: planId, userId } });
  if (!plan) throw new PlanError("Plan not found.", true);
  if (plan.transactionId) throw new PlanError("This plan has already happened.");
  return plan;
}

/** @throws PlanError when the plan is not open or its account is archived. */
export async function recordPlannedTransaction(
  db: PrismaClient,
  userId: string,
  planId: string,
  dateYmd?: string | null,
): Promise<{ transactionId: string; type: TransactionType }> {
  const plan = await findOpenPlan(db, userId, planId);
  const date = dateYmd && /^\d{4}-\d{2}-\d{2}$/.test(dateYmd) ? dateFromYmd(dateYmd) : plan.date;
  const type = plan.type === TransactionType.INCOME ? TransactionType.INCOME : TransactionType.EXPENSE;
  const account = await db.account.findFirst({ where: { id: plan.accountId, userId, archived: false }, select: { id: true } });
  if (!account) throw new PlanError("Selected account was not found or is archived.");

  const created = await db.$transaction(async (tx) => {
    const entry = await tx.transaction.create({
      data: {
        userId,
        accountId: plan.accountId,
        categoryId: plan.categoryId,
        type,
        amountCents: plan.amountCents,
        date,
        title: plan.name,
        note: plan.note,
      },
      select: { id: true },
    });
    const { count } = await tx.plannedTransaction.updateMany({
      where: { id: plan.id, userId, transactionId: null },
      data: { transactionId: entry.id },
    });
    if (count === 0) throw new PlanError("This plan has already happened.");
    return entry;
  });
  return { transactionId: created.id, type };
}
