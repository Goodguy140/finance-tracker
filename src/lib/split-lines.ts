import type { Prisma } from "@prisma/client";
import { MAX_AMOUNT, toCents } from "./money";

/**
 * The lines of a split expense: one purchase spread over several categories. The parent
 * `Transaction` keeps the whole amount; each `SplitTransactionPart` says how much of it
 * counts toward one category, and every total that goes by category reads the parts.
 *
 * There is no form for typing a new split in: new splits come only from a rule's "Split by
 * percentage" (`ruleSplitLines`), and the edit dialog edits the lines of an expense that is
 * already split. Lines always add up to the parent's `amountCents`, so the per-category
 * figures and the expense's own total never disagree.
 */

/** Marks a form that carries the split lines, so a form without them leaves them alone. */
export const SPLIT_LINES_FIELD = "splitLinesField";

export type SplitLineInput = { categoryId: string; amountCents: number };

/**
 * Reads the edit dialog's split lines: parallel `splitCategoryId` and `splitAmount` fields.
 * A line left entirely blank is skipped; a half-filled one is an error.
 * Returns null when the form does not carry the lines at all.
 */
export function parseSplitLinesFromForm(formData: FormData): SplitLineInput[] | null {
  if (formData.get(SPLIT_LINES_FIELD) == null) return null;
  const categoryIds = formData.getAll("splitCategoryId").map((v) => String(v ?? "").trim());
  const amounts = formData.getAll("splitAmount").map((v) => String(v ?? "").trim());
  if (categoryIds.length !== amounts.length) {
    throw new Error("The split lines could not be read. Try again.");
  }

  const lines: SplitLineInput[] = [];
  for (let i = 0; i < amounts.length; i += 1) {
    const categoryId = categoryIds[i];
    const amountRaw = amounts[i];
    if (amountRaw === "" && categoryId === "") continue;
    if (categoryId === "") throw new Error("Pick a category for each split line.");
    const amount = Number(amountRaw);
    if (amountRaw === "" || !Number.isFinite(amount) || amount === 0) {
      throw new Error("Enter an amount for each split line.");
    }
    if (Math.abs(amount) > MAX_AMOUNT) throw new Error(`Amounts cannot exceed ${MAX_AMOUNT.toLocaleString("en-CA")}.`);
    lines.push({ categoryId, amountCents: toCents(amount) });
  }
  return lines;
}

/** @throws when there are no lines, or they do not add up to the expense's amount. */
export function assertSplitLinesMatch(lines: ReadonlyArray<SplitLineInput>, totalCents: number): void {
  if (lines.length === 0) throw new Error("A split expense needs at least one line.");
  const sum = lines.reduce((acc, line) => acc + line.amountCents, 0);
  if (sum !== totalCents) {
    throw new Error(
      `The split lines add up to ${(sum / 100).toFixed(2)}, but the expense is ${(totalCents / 100).toFixed(2)}. Make them match.`,
    );
  }
}

/**
 * Replaces an expense's split parts with `lines`. A single line is no longer a split: the
 * parts are removed and the caller books the expense in that line's category instead.
 */
export async function saveSplitLines(
  tx: Prisma.TransactionClient,
  input: { userId: string; transactionId: string; lines: ReadonlyArray<SplitLineInput> },
): Promise<void> {
  await tx.splitTransactionPart.deleteMany({
    where: { userId: input.userId, transactionId: input.transactionId },
  });
  if (input.lines.length < 2) return;
  await tx.splitTransactionPart.createMany({
    data: input.lines.map((line) => ({
      userId: input.userId,
      transactionId: input.transactionId,
      categoryId: line.categoryId,
      amountCents: line.amountCents,
    })),
  });
}
