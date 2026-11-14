import { CategoryKind, SpendingRole, type PrismaClient } from "@prisma/client";
import { z } from "zod";
import { selectActiveBudgetsByCategory } from "@/lib/active-budgets";
import { applyBudgetSuggestions, BudgetEditError } from "@/lib/budget-edits";
import { loadBudgetSuggestions } from "@/lib/budget-suggestions-data";
import {
  CategoryEditError,
  createCategory,
  deleteCategory,
  MAX_CATEGORY_NAME_LENGTH,
  renameCategory,
  setCategoryGroup,
  setCategorySpendingRole,
} from "@/lib/category-edits";
import { formatYmShortLabel } from "@/lib/dashboard-period";
import { homeCurrencyOf } from "@/lib/home-currency";
import { MAX_AMOUNT_CENTS } from "@/lib/money";
import { currentYmInTimeZone } from "@/lib/period-month";
import { resuggestStagedCategories } from "@/lib/plaid/category-suggestions";
import { deleteTag, renameTag, TagEditError } from "@/lib/tag-edits";

/**
 * Settings → Categories and the tag list for the phone, written by the website's own
 * `category-edits.ts`, `tag-edits.ts` and `budget-edits.ts`: add, rename (into another's name
 * merges), delete with somewhere for the entries to go, group and need or want; Suggest budgets;
 * rename, merge and delete tags.
 */

type User = { id: string; timezone: string; countryCode: string | null };

export type EditResult<T = object> = ({ ok: true } & T) | { ok: false; status: 400 | 404; error: string };

function refused(err: unknown): { ok: false; status: 400 | 404; error: string } {
  if (err instanceof CategoryEditError || err instanceof TagEditError || err instanceof BudgetEditError) {
    return { ok: false, status: err.notFound ? 404 : 400, error: err.message };
  }
  throw err;
}

function invalid(error: z.ZodError, fallback: string): { ok: false; status: 400; error: string } {
  return { ok: false, status: 400, error: error.issues[0]?.message ?? fallback };
}

const name = z.string().max(MAX_CATEGORY_NAME_LENGTH * 2, `Category names can be at most ${MAX_CATEGORY_NAME_LENGTH} characters.`);

const createSchema = z
  .object({
    name,
    kind: z.enum(["expense", "income"], "A category is for spending or for income."),
    /** A monthly budget from this month on, for an expense category. */
    limitCents: z.number().int().min(1, "Enter a monthly limit above zero.").max(MAX_AMOUNT_CENTS).nullable().optional(),
  })
  .strict();

const patchSchema = z
  .object({
    /** Another category's name (ignoring case) merges this one into it. */
    name: name.optional(),
    /** Empty or null takes it out of its group. */
    groupName: z.string().max(200).nullable().optional(),
    /** Null goes back to the guess from its name. */
    spendingRole: z.enum(["need", "want"]).nullable().optional(),
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0, "Send name, groupName or spendingRole.");

export async function createCategoryFromApi(db: PrismaClient, user: User, body: unknown): Promise<EditResult<{ id: string }>> {
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return invalid(parsed.error, "Invalid category.");
  try {
    const kind = parsed.data.kind === "income" ? CategoryKind.INCOME : CategoryKind.EXPENSE;
    return { ok: true, id: await createCategory(db, user, { name: parsed.data.name, kind, limitCents: parsed.data.limitCents ?? null }) };
  } catch (err) {
    return refused(err);
  }
}

/**
 * Changes what the body names. A rename into another category's name merges the two, and the
 * result says which one it went into; the group and need or want are then the other's.
 */
export async function patchCategoryFromApi(
  db: PrismaClient,
  user: User,
  categoryId: string,
  body: unknown,
): Promise<EditResult<{ id: string; mergedInto: { id: string; name: string } | null }>> {
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return invalid(parsed.error, "Invalid category.");
  const change = parsed.data;
  try {
    if (change.groupName !== undefined) await setCategoryGroup(db, user.id, categoryId, change.groupName ?? "");
    if (change.spendingRole !== undefined) {
      const role = change.spendingRole === "need" ? SpendingRole.NEED : change.spendingRole === "want" ? SpendingRole.WANT : null;
      await setCategorySpendingRole(db, user.id, categoryId, role);
    }
    let mergedInto: { id: string; name: string } | null = null;
    if (change.name !== undefined) {
      mergedInto = await renameCategory(db, user.id, categoryId, change.name);
      // Rows waiting in the bank queue pointed at a merged category: propose what is there now.
      if (mergedInto) await resuggestStagedCategories(user.id, user.timezone, db);
    }
    return { ok: true, id: mergedInto?.id ?? categoryId, mergedInto: mergedInto ? { id: mergedInto.id, name: mergedInto.name } : null };
  } catch (err) {
    return refused(err);
  }
}

/** Deletes a category, moving its entries, budgets and rules to `moveTo` when it has any. */
export async function deleteCategoryFromApi(db: PrismaClient, user: User, categoryId: string, moveTo: string | null): Promise<EditResult> {
  try {
    await deleteCategory(db, user.id, categoryId, moveTo || null);
    await resuggestStagedCategories(user.id, user.timezone, db);
    return { ok: true };
  } catch (err) {
    return refused(err);
  }
}

/** `GET /api/v1/categories`' extra fields: group, need or want, and what deleting it would have to move. */
export async function loadCategoryDetails(db: PrismaClient, userId: string) {
  const [categories, transactions, splits, recurring, planned] = await Promise.all([
    db.category.findMany({
      where: { userId },
      orderBy: [{ kind: "asc" }, { name: "asc" }],
      select: { id: true, name: true, kind: true, groupName: true, spendingRole: true },
    }),
    db.transaction.groupBy({ by: ["categoryId"], where: { userId }, _count: { _all: true } }),
    db.splitTransactionPart.groupBy({ by: ["categoryId"], where: { userId }, _count: { _all: true } }),
    db.recurringTransaction.groupBy({ by: ["categoryId"], where: { userId }, _count: { _all: true } }),
    db.plannedTransaction.groupBy({ by: ["categoryId"], where: { userId }, _count: { _all: true } }),
  ]);
  const uses = new Map<string, number>();
  for (const rows of [transactions, splits, recurring, planned]) {
    for (const row of rows) if (row.categoryId) uses.set(row.categoryId, (uses.get(row.categoryId) ?? 0) + row._count._all);
  }
  return categories.map((c) => ({
    id: c.id,
    name: c.name,
    kind: c.kind.toLowerCase(),
    groupName: c.groupName,
    spendingRole: c.spendingRole ? (c.spendingRole.toLowerCase() as "need" | "want") : null,
    /** Entries, split parts, recurring rules and plans in it: deleting it moves them to another category. */
    uses: uses.get(c.id) ?? 0,
  }));
}

/** `GET /api/v1/budgets/suggestions`: the website's Suggest budgets, from the last 3 and 6 full months. */
export async function loadAppBudgetSuggestions(db: PrismaClient, user: User) {
  const ym = currentYmInTimeZone(user.timezone);
  const currency = homeCurrencyOf(user.countryCode);
  const [sets, budgets] = await Promise.all([
    loadBudgetSuggestions(user.id, currency, ym),
    db.budget.findMany({ where: { userId: user.id }, select: { categoryId: true, periodMonth: true, limitCents: true } }),
  ]);
  return {
    currency,
    /** Every expense category's budget this month, for the total after setting the ticked ones. */
    currentBudgets: [...selectActiveBudgetsByCategory(budgets, ym)].map(([categoryId, b]) => ({ categoryId, limitCents: b.limitCents })),
    sets: sets.map((set) => ({
      window: set.window,
      months: set.months.map((month) => ({ month, label: formatYmShortLabel(month, false) })),
      /** "Jun 2026 to Oct 2026"; null with no full month yet. */
      span:
        set.months.length === 0
          ? null
          : `${formatYmShortLabel(set.months[0])}${set.months.length > 1 ? ` to ${formatYmShortLabel(set.months[set.months.length - 1])}` : ""}`,
      averageIncomeCents: set.averageIncomeCents,
      rows: set.rows.map((row) => ({
        categoryId: row.categoryId,
        categoryName: row.categoryName,
        suggestedCents: row.suggestedCents,
        /** Spend in each of `months`, in order. */
        monthlyCents: row.monthlyCents,
        /** Months well above the typical one, which the suggestion passes over. */
        spikeMonths: row.spikeMonths,
        currentLimitCents: row.currentLimitCents,
      })),
    })),
  };
}

const applySchema = z
  .object({
    budgets: z
      .array(z.object({ categoryId: z.string().min(1), limitCents: z.number().int().min(1, "Enter a limit above zero.").max(MAX_AMOUNT_CENTS) }).strict())
      .min(1, "Tick at least one budget to set.")
      .max(500),
  })
  .strict();

export async function applyBudgetSuggestionsFromApi(db: PrismaClient, user: User, body: unknown): Promise<EditResult<{ set: number }>> {
  const parsed = applySchema.safeParse(body);
  if (!parsed.success) return invalid(parsed.error, "Tick at least one budget to set.");
  try {
    await applyBudgetSuggestions(db, user, parsed.data.budgets);
    return { ok: true, set: new Set(parsed.data.budgets.map((b) => b.categoryId)).size };
  } catch (err) {
    return refused(err);
  }
}

const tagPatchSchema = z.object({ name: z.string().max(200) }).strict();

/** Renames a tag; another tag's name merges the two, and the result says which it went into. */
export async function patchTagFromApi(
  db: PrismaClient,
  userId: string,
  tagId: string,
  body: unknown,
): Promise<EditResult<{ id: string; mergedInto: { id: string; name: string } | null }>> {
  const parsed = tagPatchSchema.safeParse(body);
  if (!parsed.success) return invalid(parsed.error, "Send the tag's new name.");
  try {
    const mergedInto = await renameTag(db, userId, tagId, parsed.data.name);
    return { ok: true, id: mergedInto?.id ?? tagId, mergedInto };
  } catch (err) {
    return refused(err);
  }
}

export async function deleteTagFromApi(db: PrismaClient, userId: string, tagId: string): Promise<EditResult> {
  try {
    await deleteTag(db, userId, tagId);
    return { ok: true };
  } catch (err) {
    return refused(err);
  }
}
