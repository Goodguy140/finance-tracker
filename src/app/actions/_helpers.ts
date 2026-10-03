import { CategoryKind, TransactionType } from "@prisma/client";
import { unstable_rethrow } from "next/navigation";
import { describeActionError, isExpectedActionError } from "@/lib/action-errors";
import type { ActionFailure } from "@/lib/action-result";
import { prisma } from "@/lib/prisma";

export { publicSignupAllowed, resolveSignupRole } from "@/lib/signup-policy";

export type FormActionResult = ActionFailure | undefined;

/**
 * Wraps a form action so failures come back as a value instead of a thrown error.
 *
 * Next.js strips the message from any error a server action throws in production, so a
 * thrown "Expense not found." reaches the browser as a generic notice. Actions keep
 * throwing internally (guards, zod, rate limits); this turns those into
 * `{ ok: false, error }` for the client, logs anything unexpected server-side, and lets
 * Next's own control-flow throws (`redirect`, `notFound`) pass through untouched.
 */
export function formAction(
  fn: (formData: FormData) => Promise<void>,
): (formData: FormData) => Promise<FormActionResult> {
  return async (formData) => {
    try {
      await fn(formData);
      return undefined;
    } catch (err) {
      unstable_rethrow(err);
      if (!isExpectedActionError(err)) console.error("[action] unexpected failure", err);
      return { ok: false, error: describeActionError(err) };
    }
  };
}

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

/** The two enums share their values: each transaction type has categories of its own kind. */
export function categoryKindForTransactionType(type: TransactionType): CategoryKind {
  return type;
}
