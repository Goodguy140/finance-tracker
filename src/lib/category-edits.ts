import { CategoryKind, type Prisma, type PrismaClient, type SpendingRole } from "@prisma/client";
import { normalizeGroupName } from "@/lib/category-groups";
import { currentYmInTimeZone } from "@/lib/period-month";

/**
 * Category management shared by Settings → Categories (`src/app/actions/categories.ts`) and the
 * phone (`/api/v1/categories`): add, rename (into another's name merges the two), merge, delete
 * with somewhere for its entries to go, its group and whether it is a need or a want.
 *
 * Only expense and income categories are managed. The one transfer category is the app's own
 * (see `ensureFallbackCategory`), and nothing should rename or remove it.
 */

export class CategoryEditError extends Error {
  constructor(
    message: string,
    readonly notFound = false,
  ) {
    super(message);
    this.name = "CategoryEditError";
  }
}

export const MAX_CATEGORY_NAME_LENGTH = 80;
const MANAGEABLE_KINDS: CategoryKind[] = [CategoryKind.EXPENSE, CategoryKind.INCOME];

type Db = PrismaClient;
type Tx = Prisma.TransactionClient;

export function normalizeCategoryName(raw: string): string {
  const name = raw.trim().replace(/\s+/g, " ");
  if (!name) throw new CategoryEditError("Enter a name for the category.");
  if (name.length > MAX_CATEGORY_NAME_LENGTH) {
    throw new CategoryEditError(`Category names can be at most ${MAX_CATEGORY_NAME_LENGTH} characters.`);
  }
  return name;
}

/** The user's expense or income category. @throws CategoryEditError */
export async function findManagedCategory(client: Tx | Db, userId: string, categoryId: string) {
  const category = categoryId
    ? await client.category.findFirst({ where: { id: categoryId, userId, kind: { in: MANAGEABLE_KINDS } } })
    : null;
  if (!category) throw new CategoryEditError("Category not found.", true);
  return category;
}

/** Another category of the same kind whose name matches ignoring case, if any. */
async function findSameName(tx: Tx, userId: string, kind: CategoryKind, name: string, exceptId?: string) {
  const sameKind = await tx.category.findMany({ where: { userId, kind }, select: { id: true, name: true } });
  const key = name.toLowerCase();
  return sameKind.find((c) => c.id !== exceptId && c.name.toLowerCase() === key);
}

/**
 * Moves everything that points at `fromId` onto `toId`, then deletes `fromId`.
 *
 * Budgets: where both categories have a limit for the same month, the target's is kept —
 * merging is "this was always that", so the category being merged away gives up its own.
 * Every other month's limit moves across. Budget alert history for the old category is
 * dropped; the merged spend is judged against the target's limit from here on.
 */
async function mergeCategoryInto(tx: Tx, userId: string, fromId: string, toId: string) {
  const move = { where: { userId, categoryId: fromId }, data: { categoryId: toId } };
  await tx.transaction.updateMany(move);
  await tx.splitTransactionPart.updateMany(move);
  await tx.recurringTransaction.updateMany(move);
  await tx.plannedTransaction.updateMany(move);
  await tx.plaidCategoryMapping.updateMany(move);
  await tx.plaidItem.updateMany({ where: { userId, defaultCategoryId: fromId }, data: { defaultCategoryId: toId } });
  await tx.transactionRule.updateMany({ where: { userId, setCategoryId: fromId }, data: { setCategoryId: toId } });
  await tx.savedSearch.updateMany(move);
  await tx.transactionRuleSplit.updateMany({
    where: { categoryId: fromId, rule: { userId } },
    data: { categoryId: toId },
  });
  await tx.plaidStagedTransaction.updateMany({
    where: { userId, suggestedCategoryId: fromId },
    data: { suggestedCategoryId: toId },
  });

  const [fromBudgets, toBudgets] = await Promise.all([
    tx.budget.findMany({ where: { userId, categoryId: fromId }, select: { id: true, periodMonth: true } }),
    tx.budget.findMany({ where: { userId, categoryId: toId }, select: { periodMonth: true } }),
  ]);
  const targetMonths = new Set(toBudgets.map((b) => b.periodMonth));
  const clashing = fromBudgets.filter((b) => targetMonths.has(b.periodMonth)).map((b) => b.id);
  if (clashing.length > 0) await tx.budget.deleteMany({ where: { id: { in: clashing } } });
  await tx.budget.updateMany(move);
  await tx.budgetAlertNotification.deleteMany({ where: { userId, categoryId: fromId } });

  // Yearly budgets merge the same way: the target keeps its own for a year both have.
  const [fromYearly, toYearly] = await Promise.all([
    tx.yearlyBudget.findMany({ where: { userId, categoryId: fromId }, select: { id: true, year: true } }),
    tx.yearlyBudget.findMany({ where: { userId, categoryId: toId }, select: { year: true } }),
  ]);
  const targetYears = new Set(toYearly.map((b) => b.year));
  const clashingYears = fromYearly.filter((b) => targetYears.has(b.year)).map((b) => b.id);
  if (clashingYears.length > 0) await tx.yearlyBudget.deleteMany({ where: { id: { in: clashingYears } } });
  await tx.yearlyBudget.updateMany(move);

  await tx.category.delete({ where: { id: fromId } });
}

/** Adds a category, with an optional monthly budget from this month on. Returns its id. */
export async function createCategory(
  db: Db,
  user: { id: string; timezone: string | null },
  input: { name: string; kind: CategoryKind; limitCents: number | null },
): Promise<string> {
  const name = normalizeCategoryName(input.name);
  if (!MANAGEABLE_KINDS.includes(input.kind)) throw new CategoryEditError("A category is for spending or for income.");
  if (input.limitCents !== null && input.kind !== CategoryKind.EXPENSE) {
    throw new CategoryEditError("Budgets apply to expense categories only.");
  }
  return db.$transaction(async (tx) => {
    if (await findSameName(tx, user.id, input.kind, name)) {
      throw new CategoryEditError(`You already have a category called “${name}”.`);
    }
    const created = await tx.category.create({ data: { userId: user.id, name, kind: input.kind }, select: { id: true } });
    if (input.limitCents !== null) {
      await tx.budget.create({
        data: { userId: user.id, categoryId: created.id, periodMonth: currentYmInTimeZone(user.timezone), limitCents: input.limitCents },
      });
    }
    return created.id;
  });
}

/**
 * Renames a category. Renaming it to the name of another category of the same kind merges the
 * two, so "Eating out" and "Dining" can be tidied into one without re-filing every transaction
 * by hand. Returns the category it was merged into, or null for a plain rename.
 */
export async function renameCategory(db: Db, userId: string, categoryId: string, rawName: string): Promise<{ id: string; name: string } | null> {
  const name = normalizeCategoryName(rawName);
  return db.$transaction(async (tx) => {
    const category = await findManagedCategory(tx, userId, categoryId);
    const other = await findSameName(tx, userId, category.kind, name, category.id);
    if (other) {
      await mergeCategoryInto(tx, userId, category.id, other.id);
      return other;
    }
    await tx.category.update({ where: { id: category.id }, data: { name } });
    return null;
  });
}

/** Merges one category into another of the same kind. */
export async function mergeCategory(db: Db, userId: string, fromId: string, toId: string): Promise<void> {
  await db.$transaction(async (tx) => {
    const from = await findManagedCategory(tx, userId, fromId);
    const to = await findManagedCategory(tx, userId, toId);
    if (from.id === to.id) throw new CategoryEditError("Pick a different category to merge into.");
    if (from.kind !== to.kind) throw new CategoryEditError("Expense and income categories cannot be merged.");
    await mergeCategoryInto(tx, userId, from.id, to.id);
  });
}

/**
 * Deletes a category. One that transactions, splits, recurring rules or plans use needs
 * somewhere for them to go, so it is merged into `targetId` instead; an unused one simply goes,
 * along with its budgets. Rules that set it stop setting a category (the relation's SetNull).
 */
export async function deleteCategory(db: Db, userId: string, categoryId: string, targetId: string | null): Promise<void> {
  await db.$transaction(async (tx) => {
    const category = await findManagedCategory(tx, userId, categoryId);
    const remaining = await tx.category.count({ where: { userId, kind: category.kind } });
    if (remaining <= 1) {
      throw new CategoryEditError(`Keep at least one ${category.kind === CategoryKind.INCOME ? "income" : "expense"} category.`);
    }
    if (targetId) {
      const target = await findManagedCategory(tx, userId, targetId);
      if (target.id === category.id) throw new CategoryEditError("Pick a different category to move its transactions to.");
      if (target.kind !== category.kind) throw new CategoryEditError("Expense and income categories cannot be merged.");
      await mergeCategoryInto(tx, userId, category.id, target.id);
      return;
    }
    if ((await categoryUses(tx, userId, category.id)) > 0) {
      throw new CategoryEditError("This category is in use. Choose a category to move its transactions to.");
    }
    await tx.budget.deleteMany({ where: { userId, categoryId: category.id } });
    await tx.budgetAlertNotification.deleteMany({ where: { userId, categoryId: category.id } });
    await tx.category.delete({ where: { id: category.id } });
  });
}

/** Transactions, split parts, recurring rules and plans in a category: what deleting it must move. */
async function categoryUses(tx: Tx | Db, userId: string, categoryId: string): Promise<number> {
  const [transactions, splitParts, recurring, planned] = await Promise.all([
    tx.transaction.count({ where: { userId, categoryId } }),
    tx.splitTransactionPart.count({ where: { userId, categoryId } }),
    tx.recurringTransaction.count({ where: { userId, categoryId } }),
    tx.plannedTransaction.count({ where: { userId, categoryId } }),
  ]);
  return transactions + splitParts + recurring + planned;
}

/** A need or a want for the financial score's 50/30/20 split, or null for the guess from its name. */
export async function setCategorySpendingRole(db: Db, userId: string, categoryId: string, spendingRole: SpendingRole | null): Promise<void> {
  const category = await findManagedCategory(db, userId, categoryId);
  if (category.kind !== CategoryKind.EXPENSE) throw new CategoryEditError("Only spending categories are needs or wants.");
  await db.category.update({ where: { id: category.id }, data: { spendingRole } });
}

/**
 * Files a category under a group, or takes it out of one (an empty name). A group is matched to
 * an existing one ignoring case, so "food" joins "Food" rather than starting a second group.
 */
export async function setCategoryGroup(db: Db, userId: string, categoryId: string, rawGroup: string): Promise<void> {
  const category = await findManagedCategory(db, userId, categoryId);
  let groupName = normalizeGroupName(rawGroup);
  if (groupName) {
    const existing = await db.category.findMany({
      where: { userId, groupName: { not: null }, NOT: { id: category.id } },
      select: { groupName: true },
    });
    groupName = existing.find((c) => c.groupName!.toLowerCase() === groupName!.toLowerCase())?.groupName ?? groupName;
  }
  await db.category.update({ where: { id: category.id }, data: { groupName } });
}
