import { CategoryKind, TransactionType } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export { publicSignupAllowed, resolveSignupRole } from "@/lib/signup-policy";

export function getFormValue(formData: FormData, key: string) {
  return String(formData.get(key) ?? "");
}

/**
 * `JSON.parse` for a form field the client serialised. A malformed value used to escape as
 * a raw `SyntaxError`; callers get their own message instead. Empty input yields `fallback`.
 */
export function parseJsonField<T>(raw: string, fallback: T, message: string): T {
  if (!raw.trim()) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new Error(message);
  }
}

/**
 * Bulk imports (a whole backup, a statement of a few thousand rows) do not fit Prisma's
 * default 5s interactive-transaction budget, and blowing the budget rolls everything back.
 * Generous on purpose: these run rarely and a partial import is worse than a slow one.
 */
export const LONG_TRANSACTION_OPTIONS = { maxWait: 15_000, timeout: 180_000 } as const;

export function getOptionalMappedValue(row: Record<string, string>, key?: string) {
  if (!key) return undefined;
  return row[key]?.trim() || undefined;
}

export async function assertUserOwnsAccount(userId: string, accountId: string) {
  const account = await prisma.account.findFirst({
    where: { id: accountId, userId },
    select: { id: true },
  });
  if (!account) {
    throw new Error("Selected account was not found.");
  }
}

export async function assertUserOwnsActiveAccount(userId: string, accountId: string) {
  const account = await prisma.account.findFirst({
    where: { id: accountId, userId, archived: false },
    select: { id: true },
  });
  if (!account) {
    throw new Error("Selected account was not found or is archived.");
  }
}

export async function assertUserOwnsCategory(userId: string, categoryId: string, kind?: CategoryKind) {
  const category = await prisma.category.findFirst({
    where: { id: categoryId, userId, ...(kind ? { kind } : {}) },
    select: { id: true },
  });
  if (!category) {
    throw new Error("Selected category was not found.");
  }
}

export function categoryKindForTransactionType(type: TransactionType): CategoryKind {
  return type === TransactionType.INCOME ? CategoryKind.INCOME : CategoryKind.EXPENSE;
}
