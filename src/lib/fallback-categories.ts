import { CategoryKind, type Prisma, type PrismaClient } from "@prisma/client";
import { FALLBACK_CATEGORY_NAME, OTHER_CATEGORY_ALIASES, type UserCategory } from "@/lib/plaid/category-map";
import { TRANSFER_CATEGORY_NAME } from "@/lib/transfer-type";

type Client = PrismaClient | Prisma.TransactionClient;

/**
 * The catch-all category for a kind: the user's own, or a created one as a last resort.
 *
 * Nothing should invent a category, so any catch-all the user already has is used —
 * including the "Uncategorized" that earlier versions of the Plaid sync created. Creating is
 * reached only by a user who has none, because `Transaction.categoryId` is non-nullable
 * with `onDelete: Restrict`: there is no "no category" for a row to point at.
 *
 * A transfer's catch-all is its only category: the first TRANSFER-kind category the user
 * has, or "Transfers".
 */
export async function ensureFallbackCategory(
  client: Client,
  userId: string,
  kind: CategoryKind,
  categories: UserCategory[],
): Promise<string> {
  if (kind === CategoryKind.TRANSFER) {
    const existing = categories.find((category) => category.kind === CategoryKind.TRANSFER);
    if (existing) return existing.id;
  } else {
    const aliases = new Set(OTHER_CATEGORY_ALIASES.map((name) => name.trim().toLowerCase()));
    const existing = categories.find(
      (category) => category.kind === kind && aliases.has(category.name.trim().toLowerCase()),
    );
    if (existing) return existing.id;
  }

  const name = kind === CategoryKind.TRANSFER ? TRANSFER_CATEGORY_NAME : FALLBACK_CATEGORY_NAME;
  // Upsert rather than create: two items of the same user can sync at once, and the lock
  // they hold is per item.
  const created = await client.category.upsert({
    where: { userId_name_kind: { userId, name, kind } },
    create: { userId, kind, name },
    update: {},
    select: { id: true },
  });
  return created.id;
}

/** `ensureFallbackCategory` for a caller that has not already loaded the user's categories. */
export async function ensureFallbackCategoryFor(client: Client, userId: string, kind: CategoryKind): Promise<string> {
  const categories = await client.category.findMany({
    where: { userId, kind },
    select: { id: true, name: true, kind: true },
    orderBy: { createdAt: "asc" },
  });
  return ensureFallbackCategory(client, userId, kind, categories);
}
