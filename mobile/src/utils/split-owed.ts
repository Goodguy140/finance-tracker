import type { OwedShare } from '@/api/types';
import { formatCents } from '@/utils/money';

/**
 * An expense's split lines and who owes part of it back, as the phone's editor holds them: typed
 * text until saved, then sent whole to `PATCH /api/v1/transactions/:id`, as the website's edit
 * dialog sends them. Lines add up to the entry's amount; shares come out of what was paid; one
 * entry never has both.
 */

export type SplitLine = { key: string; categoryId: string; amount: string };
export type OwedLine = { key: string; id: string | null; name: string; amount: string; paid: boolean };

let nextKey = 0;
/** A key for a new line, unique within the editor. */
export function lineKey(): string {
  nextKey += 1;
  return `new-${nextKey}`;
}

/** "12.50", "1,234.5", "$-3" → cents, or null for anything that is not a non-zero amount. */
function cents(raw: string): number | null {
  const cleaned = raw.replace(/[\s,$]/g, '');
  if (!/^-?\d+(\.\d{0,2})?$|^-?\.\d{1,2}$/.test(cleaned)) return null;
  const value = Math.round(Number(cleaned) * 100);
  return Number.isFinite(value) && value !== 0 ? value : null;
}

export function splitLinesFrom(splits: readonly { categoryId: string; amountCents: number }[]): SplitLine[] {
  return splits.map((line, i) => ({ key: `split-${i}`, categoryId: line.categoryId, amount: (line.amountCents / 100).toFixed(2) }));
}

export function owedLinesFrom(shares: readonly OwedShare[]): OwedLine[] {
  return shares.map((share) => ({
    key: share.id,
    id: share.id,
    name: share.name,
    amount: (share.amountCents / 100).toFixed(2),
    paid: share.paidAt !== null,
  }));
}

/** The split lines as the server takes them, or what is wrong with one. */
export function parseSplitLines(lines: readonly SplitLine[]): { lines: { categoryId: string; amountCents: number }[] } | { error: string } {
  const parsed: { categoryId: string; amountCents: number }[] = [];
  for (const line of lines) {
    if (!line.categoryId) return { error: 'Pick a category for each split line.' };
    const value = cents(line.amount);
    if (value === null) return { error: 'Enter an amount for each split line, like 12.50.' };
    parsed.push({ categoryId: line.categoryId, amountCents: value });
  }
  return { lines: parsed };
}

/** What the split lines add up to, or null while one is not a number yet. */
export function splitTotal(lines: readonly SplitLine[]): number | null {
  let sum = 0;
  for (const line of lines) {
    const value = cents(line.amount);
    if (value === null) return null;
    sum += value;
  }
  return sum;
}

/** The shares as the server takes them (blank rows dropped), or what is wrong with one. */
export function parseOwedLines(lines: readonly OwedLine[]): { shares: { id: string | null; name: string; amountCents: number }[] } | { error: string } {
  const shares: { id: string | null; name: string; amountCents: number }[] = [];
  for (const line of lines) {
    const name = line.name.trim();
    if (!name && !line.amount.trim()) continue;
    if (!name) return { error: 'Say who owes each amount.' };
    const value = cents(line.amount);
    if (value === null || value < 0) return { error: `Enter a positive amount owed by ${name}.` };
    shares.push({ id: line.id, name, amountCents: value });
  }
  return { shares };
}

/** "Your part: $30.00" under what was paid, or what is wrong. */
export function ownPartNote(paidCents: number | null, lines: readonly OwedLine[], currency: string): string | null {
  const parsed = parseOwedLines(lines);
  if (paidCents === null || 'error' in parsed || parsed.shares.length === 0) return null;
  const owed = parsed.shares.reduce((sum, share) => sum + share.amountCents, 0);
  if (owed > paidCents) return 'What others owe adds up to more than you paid.';
  return `Your part: ${formatCents(paidCents - owed, currency)}. Only your part counts as spending.`;
}

/** "Left to split: $5.00" while the lines do not add up yet, or null once they do. */
export function splitRemainderNote(totalCents: number, lines: readonly SplitLine[], currency: string): string | null {
  const sum = splitTotal(lines);
  if (sum === null) return null;
  if (sum === totalCents) return null;
  return sum < totalCents
    ? `${formatCents(totalCents - sum, currency)} left to split.`
    : `The lines are ${formatCents(sum - totalCents, currency)} more than the total.`;
}

export function sameSplitLines(a: readonly SplitLine[], b: readonly SplitLine[]): boolean {
  return a.length === b.length && a.every((line, i) => line.categoryId === b[i].categoryId && cents(line.amount) === cents(b[i].amount));
}

export function sameOwedLines(a: readonly OwedLine[], b: readonly OwedLine[]): boolean {
  const pa = parseOwedLines(a);
  const pb = parseOwedLines(b);
  if ('error' in pa || 'error' in pb) return false;
  return (
    pa.shares.length === pb.shares.length &&
    pa.shares.every((share, i) => share.id === pb.shares[i].id && share.name === pb.shares[i].name && share.amountCents === pb.shares[i].amountCents)
  );
}
