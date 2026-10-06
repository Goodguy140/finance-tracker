import type { Prisma } from "@prisma/client";
import { MAX_AMOUNT, toCents } from "./money";

/**
 * Reimbursements: the parts of a one-off expense someone else owes back.
 *
 * A share comes out of the expense's `amountCents` the moment it is marked, so every total
 * counts only the user's own part (see the `OwedShare` model). Two figures follow from that:
 *
 * - what the user paid  = `amountCents` + the shares (what the bank charged)
 * - the user's own part = `amountCents`
 *
 * Anything that compares an expense with the bank (the Plaid matcher, a revision) has to
 * use the first; everything that totals spending already uses the second.
 */

export const OWED_SHARE_NAME_MAX = 80;

/** Marks a form that carries the owed-share rows, so a form without them leaves them alone. */
export const OWED_SHARES_FIELD = "owedSharesField";

export type OwedShareInput = {
  /** The existing share this row edits; null for a new one. */
  id: string | null;
  name: string;
  amountCents: number;
};

export function owedTotalCents(shares: ReadonlyArray<{ amountCents: number }>): number {
  return shares.reduce((sum, share) => sum + share.amountCents, 0);
}

/** What the user paid for an expense: their own part plus what others owe on it. */
export function paidCentsOf(txn: { amountCents: number; owedShares: ReadonlyArray<{ amountCents: number }> }): number {
  return txn.amountCents + owedTotalCents(txn.owedShares);
}

/**
 * Reads the edit dialog's owed rows: parallel `owedShareId`, `owedName` and `owedAmount`
 * fields. A row left entirely blank is skipped; a half-filled one is an error.
 * Returns null when the form does not carry the rows at all.
 */
export function parseOwedSharesFromForm(formData: FormData): OwedShareInput[] | null {
  if (formData.get(OWED_SHARES_FIELD) == null) return null;
  const ids = formData.getAll("owedShareId").map((v) => String(v ?? "").trim());
  const names = formData.getAll("owedName").map((v) => String(v ?? "").trim());
  const amounts = formData.getAll("owedAmount").map((v) => String(v ?? "").trim());
  if (ids.length !== names.length || names.length !== amounts.length) {
    throw new Error("The owed amounts could not be read. Try again.");
  }

  const rows: OwedShareInput[] = [];
  for (let i = 0; i < names.length; i += 1) {
    const name = names[i];
    const amountRaw = amounts[i];
    if (name === "" && amountRaw === "") continue;
    if (name === "") throw new Error("Say who owes each amount.");
    if (name.length > OWED_SHARE_NAME_MAX) {
      throw new Error(`Names of people who owe you are limited to ${OWED_SHARE_NAME_MAX} characters.`);
    }
    const amount = Number(amountRaw);
    if (amountRaw === "" || !Number.isFinite(amount) || amount <= 0) {
      throw new Error(`Enter a positive amount owed by ${name}.`);
    }
    if (amount > MAX_AMOUNT) throw new Error(`Amounts cannot exceed ${MAX_AMOUNT.toLocaleString("en-CA")}.`);
    rows.push({ id: ids[i] || null, name, amountCents: toCents(amount) });
  }
  return rows;
}

/**
 * The expense's own part once the shares are taken out of what the user paid.
 *
 * @throws when there are shares on a refund or credit (nothing was paid to be owed back), or
 *   when they add up to more than was paid. Exactly what was paid is allowed: a bill paid
 *   entirely on someone else's behalf leaves the user's own part at zero.
 */
export function ownPartCents(paidCents: number, shares: ReadonlyArray<{ amountCents: number }>): number {
  if (shares.length === 0) return paidCents;
  if (paidCents <= 0) throw new Error("Only a purchase can be owed back, not a refund or credit.");
  const owed = owedTotalCents(shares);
  if (owed > paidCents) throw new Error("What others owe adds up to more than you paid.");
  return paidCents - owed;
}

/**
 * Makes an expense's shares match `rows`: rows with an id update that share (keeping whether
 * it was paid back), rows without one are added, and shares no row names are removed.
 * Ids that are not this expense's are refused rather than silently dropped.
 */
export async function saveOwedShares(
  tx: Prisma.TransactionClient,
  input: { userId: string; transactionId: string; rows: OwedShareInput[] },
): Promise<void> {
  const existing = await tx.owedShare.findMany({
    where: { userId: input.userId, transactionId: input.transactionId },
    select: { id: true },
  });
  const existingIds = new Set(existing.map((share) => share.id));
  const keptIds = new Set<string>();
  for (const row of input.rows) {
    if (row.id === null) continue;
    if (!existingIds.has(row.id)) throw new Error("That owed amount no longer exists. Reload and try again.");
    keptIds.add(row.id);
  }

  const removed = [...existingIds].filter((id) => !keptIds.has(id));
  if (removed.length > 0) {
    await tx.owedShare.deleteMany({ where: { userId: input.userId, id: { in: removed } } });
  }
  for (const row of input.rows) {
    if (row.id === null) {
      await tx.owedShare.create({
        data: { userId: input.userId, transactionId: input.transactionId, name: row.name, amountCents: row.amountCents },
      });
    } else {
      await tx.owedShare.update({ where: { id: row.id }, data: { name: row.name, amountCents: row.amountCents } });
    }
  }
}
