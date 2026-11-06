import type { OwedToYou } from '@/api/types';
import { formatCents } from '@/utils/money';

export const OWED_PATH = '/api/v1/owed';

export type OwedItem = OwedToYou['items'][number];

/** Still to come back, then paid back lately (newest expense first in each), as the website lists them. */
export function splitOwed(items: readonly OwedItem[]): { outstanding: OwedItem[]; repaid: OwedItem[] } {
  return { outstanding: items.filter((i) => i.paidAt === null), repaid: items.filter((i) => i.paidAt !== null) };
}

/** "$45.00 from 2 people", for the line above the log; null when nothing is outstanding. */
export function owedSummary(owed: Pick<OwedToYou, 'items' | 'outstandingCents' | 'currency'>): string | null {
  const people = new Set(owed.items.filter((i) => i.paidAt === null).map((i) => i.name.trim().toLowerCase()));
  if (people.size === 0) return null;
  return `${formatCents(owed.outstandingCents, owed.currency)} from ${people.size === 1 ? '1 person' : `${people.size} people`}`;
}
