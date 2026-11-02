import { formatCents } from '@/utils/money';

export type Section<T> = { title: string | null; items: T[] };

/**
 * Splits rows into their category groups as the website does: groups alphabetically, the
 * ungrouped last, rows keeping their order. Group names match ignoring case. With no groups at
 * all there is one untitled section.
 */
export function sectionByGroup<T>(rows: readonly T[], groupOf: (row: T) => string | null | undefined): Section<T>[] {
  const groups = new Map<string, Section<T>>();
  const ungrouped: T[] = [];
  for (const row of rows) {
    const name = groupOf(row)?.trim();
    if (!name) {
      ungrouped.push(row);
      continue;
    }
    const key = name.toLowerCase();
    const section = groups.get(key) ?? { title: name, items: [] };
    section.items.push(row);
    groups.set(key, section);
  }
  const sections = [...groups.values()].sort((a, b) => a.title!.localeCompare(b.title!));
  if (ungrouped.length > 0) sections.push({ title: sections.length > 0 ? 'Not grouped' : null, items: ungrouped });
  return sections;
}

/** "$120.00 left" or "Over by $15.50", for a budget's spend against its limit. */
export function budgetStatus(spentCents: number, limitCents: number, currency: string): { text: string; over: boolean } {
  const left = limitCents - spentCents;
  if (left < 0) return { text: `Over by ${formatCents(-left, currency)}`, over: true };
  return { text: `${formatCents(left, currency)} left`, over: false };
}

/** What rollover added to or took from this month's limit, or null when nothing carried. */
export function rolloverNote(rolloverCents: number, currency: string): string | null {
  if (rolloverCents > 0) return `Includes ${formatCents(rolloverCents, currency)} left over from earlier months`;
  if (rolloverCents < 0) return `Less ${formatCents(-rolloverCents, currency)} overspent in earlier months`;
  return null;
}

/** A sinking fund's state: what is waiting in it, or how far spending has run ahead of it. */
export function fundNote(fundCents: number, currency: string): string {
  return fundCents >= 0
    ? `${formatCents(fundCents, currency)} in the fund`
    : `${formatCents(-fundCents, currency)} spent ahead of the fund`;
}

/** Spend as a share of the limit for a progress bar, 0 to 1; full when anything is spent against nothing. */
export function barShare(spentCents: number, limitCents: number): number {
  if (limitCents <= 0) return spentCents > 0 ? 1 : 0;
  return Math.min(Math.max(spentCents / limitCents, 0), 1);
}
