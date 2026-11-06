import { CategoryKind, TransactionType, type PrismaClient } from "@prisma/client";
import { z } from "zod";
import { dateFromYmd, ymdFromDateUtc } from "@/lib/date-only";
import { MAX_AMOUNT_CENTS } from "@/lib/money";
import { isPlanPastDue } from "@/lib/planned-transactions";
import { loadOpenPlannedTransactions, type OpenPlannedTransaction } from "@/lib/planned-transactions-data";

/**
 * One-off plans for the phone (`PlannedTransaction`): a car repair in March, a tax refund in April.
 * The same rows the website's Add card Plan tab and Upcoming bills' "+ Plan" write, read and
 * settled the same way, so a plan the phone adds shows in every forecast at once.
 */

export function serializePlans(plans: readonly OpenPlannedTransaction[], todayYmd: string) {
  return {
    today: todayYmd,
    /** Open plans, earliest first. `pastDue` ones ask "Did this happen?". */
    plans: plans.map((plan) => ({
      id: plan.id,
      type: plan.type === "INCOME" ? ("income" as const) : ("expense" as const),
      name: plan.name,
      amountCents: plan.amountCents,
      currency: plan.account.currency,
      date: ymdFromDateUtc(plan.date),
      accountId: plan.account.id,
      accountName: plan.account.name,
      categoryId: plan.category.id,
      categoryName: plan.category.name,
      note: plan.note,
      pastDue: isPlanPastDue(plan, todayYmd),
    })),
  };
}

export type AppPlans = ReturnType<typeof serializePlans>;

export async function loadAppPlans(db: PrismaClient, userId: string, todayYmd: string): Promise<AppPlans> {
  return serializePlans(await loadOpenPlannedTransactions(userId, {}, db), todayYmd);
}

const planSchema = z
  .object({
    type: z.enum(["expense", "income"]),
    name: z.string().trim().min(1, "Name what you are planning for.").max(120),
    amountCents: z.number().int().min(1, "The amount must be positive.").max(MAX_AMOUNT_CENTS),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick the date you expect it."),
    accountId: z.string().min(1, "Choose an account."),
    categoryId: z.string().min(1, "Choose a category."),
    note: z.string().trim().max(250).nullable().optional(),
  })
  .strict();

type PlanData = {
  type: TransactionType;
  name: string;
  amountCents: number;
  date: Date;
  accountId: string;
  categoryId: string;
  note: string | null;
};

export type PlanResult = { ok: true; id: string } | { ok: false; status: 400 | 404 | 409; error: string };

/** The plan's fields, with the account (open) and the category (of the plan's kind) the user's own. */
async function parsePlan(db: PrismaClient, userId: string, body: unknown): Promise<{ ok: true; data: PlanData } | Extract<PlanResult, { ok: false }>> {
  const parsed = planSchema.safeParse(body);
  if (!parsed.success) return { ok: false, status: 400, error: parsed.error.issues[0]?.message ?? "Invalid plan." };
  const input = parsed.data;
  if (ymdFromDateUtc(dateFromYmd(input.date)) !== input.date) return { ok: false, status: 400, error: "That date does not exist." };
  const type = input.type === "income" ? TransactionType.INCOME : TransactionType.EXPENSE;
  const [account, category] = await Promise.all([
    db.account.count({ where: { id: input.accountId, userId, archived: false } }),
    db.category.count({ where: { id: input.categoryId, userId, kind: type === TransactionType.INCOME ? CategoryKind.INCOME : CategoryKind.EXPENSE } }),
  ]);
  if (!account) return { ok: false, status: 404, error: "Selected account was not found or is archived." };
  if (!category) return { ok: false, status: 404, error: "Selected category was not found." };
  return {
    ok: true,
    data: {
      type,
      name: input.name,
      amountCents: input.amountCents,
      date: dateFromYmd(input.date),
      accountId: input.accountId,
      categoryId: input.categoryId,
      note: input.note || null,
    },
  };
}

export async function createPlanFromApi(db: PrismaClient, userId: string, body: unknown): Promise<PlanResult> {
  const plan = await parsePlan(db, userId, body);
  if (!plan.ok) return plan;
  const created = await db.plannedTransaction.create({ data: { userId, ...plan.data }, select: { id: true } });
  return { ok: true, id: created.id };
}

/** Replaces an open plan's fields; one that has already happened is left alone. */
export async function updatePlanFromApi(db: PrismaClient, userId: string, planId: string, body: unknown): Promise<PlanResult> {
  const existing = await db.plannedTransaction.findFirst({ where: { id: planId, userId }, select: { id: true, transactionId: true } });
  if (!existing) return { ok: false, status: 404, error: "Plan not found." };
  if (existing.transactionId) return { ok: false, status: 409, error: "This plan has already happened." };
  const plan = await parsePlan(db, userId, body);
  if (!plan.ok) return plan;
  await db.plannedTransaction.update({ where: { id: existing.id }, data: plan.data });
  return { ok: true, id: existing.id };
}

/** "No, remove it" or Remove: the plan goes; nothing in the log changes. */
export async function deletePlanFromApi(db: PrismaClient, userId: string, planId: string): Promise<boolean> {
  const { count } = await db.plannedTransaction.deleteMany({ where: { id: planId, userId } });
  return count > 0;
}
