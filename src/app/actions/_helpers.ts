import { CategoryKind, TransactionType, UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export function getFormValue(formData: FormData, key: string) {
  return String(formData.get(key) ?? "");
}

export function toPeriodMonth(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

export function getOptionalMappedValue(row: Record<string, string>, key?: string) {
  if (!key) return undefined;
  return row[key]?.trim() || undefined;
}

export function publicSignupAllowed() {
  const value = process.env.ALLOW_PUBLIC_SIGNUP?.trim().toLowerCase();
  if (value === undefined) {
    return process.env.NODE_ENV !== "production";
  }
  return value === "true" || value === "1";
}

export function resolveSignupRole(email: string, existingUserCount: number): UserRole {
  if (existingUserCount > 0) return UserRole.USER;
  const initialAdmin = process.env.INITIAL_ADMIN_EMAIL?.trim().toLowerCase();
  if (!initialAdmin) return UserRole.SERVER_ADMIN;
  return email.toLowerCase() === initialAdmin ? UserRole.SERVER_ADMIN : UserRole.USER;
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
