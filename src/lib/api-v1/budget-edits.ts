import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { BudgetEditError, reallocateBudgets, setBudgetRollover, setMonthlyBudget, setYearlyBudget } from "@/lib/budget-edits";
import { MAX_AMOUNT_CENTS } from "@/lib/money";

/**
 * Budget changes from the phone, written by the website's own `src/lib/budget-edits.ts`: a
 * category's monthly budget (from this month on), rollover, and yearly budget (from this year
 * on), and an overage covered from other budgets this month.
 */

const limit = z.number().int().min(1, "Enter a limit above zero.").max(MAX_AMOUNT_CENTS);

const patchSchema = z
  .object({
    /** Null removes the monthly budget, every month of it, as the website's Remove does. */
    monthlyCents: limit.nullable().optional(),
    rollover: z.boolean().optional(),
    /** Null removes the yearly budget, every year of it. */
    yearlyCents: limit.nullable().optional(),
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0, "Send monthlyCents, rollover or yearlyCents.");

export type BudgetPatch = z.infer<typeof patchSchema>;

const coverSchema = z
  .object({
    from: z
      .array(z.object({ categoryId: z.string().min(1), amountCents: z.number().int().positive().max(MAX_AMOUNT_CENTS) }).strict())
      .min(1, "Choose at least one budget to cover the overage from.")
      .max(50),
  })
  .strict();

export type BudgetEditResult = { ok: true } | { ok: false; status: 400 | 404; error: string };

function refused(err: unknown): BudgetEditResult {
  if (err instanceof BudgetEditError) return { ok: false, status: err.notFound ? 404 : 400, error: err.message };
  throw err;
}

/**
 * Applies what the request names, in the order the website's settings read: the monthly budget
 * first (removing it turns rollover off), then rollover (which needs one), then the yearly budget.
 */
export async function patchBudgetFromApi(
  db: PrismaClient,
  user: { id: string; timezone: string },
  categoryId: string,
  body: unknown,
): Promise<BudgetEditResult> {
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return { ok: false, status: 400, error: parsed.error.issues[0]?.message ?? "Invalid budget." };
  const patch = parsed.data;
  try {
    if (patch.monthlyCents !== undefined) await setMonthlyBudget(db, user, categoryId, patch.monthlyCents);
    if (patch.rollover !== undefined) await setBudgetRollover(db, user, categoryId, patch.rollover);
    if (patch.yearlyCents !== undefined) await setYearlyBudget(db, user, categoryId, patch.yearlyCents);
  } catch (err) {
    return refused(err);
  }
  return { ok: true };
}

/** The Budgets card's "Cover overage": raise this category's limit this month from others' room. */
export async function coverBudgetFromApi(
  db: PrismaClient,
  user: { id: string; timezone: string },
  categoryId: string,
  body: unknown,
): Promise<BudgetEditResult> {
  const parsed = coverSchema.safeParse(body);
  if (!parsed.success) return { ok: false, status: 400, error: parsed.error.issues[0]?.message ?? "Invalid request." };
  try {
    await reallocateBudgets(db, user, categoryId, parsed.data.from);
  } catch (err) {
    return refused(err);
  }
  return { ok: true };
}
