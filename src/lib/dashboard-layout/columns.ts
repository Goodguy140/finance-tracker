import {
  type DashboardColumn,
  MAX_COLUMNS,
  MIN_COLUMN_PX,
  MIN_COLUMN_UNITS,
  TOTAL_COLUMN_UNITS,
} from "./schema";

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Split `total` into `count` integer shares that sum to exactly `total`, weighted by
 * `weights`. Largest-remainder rather than rounding each share independently: rounding
 * leaves the sum a unit or two off, and a layout that loses a unit on every add/remove
 * would visibly drift narrower over a session.
 */
export function largestRemainder(weights: readonly number[], total: number): number[] {
  const weightSum = weights.reduce((sum, w) => sum + w, 0);
  if (weightSum <= 0) {
    // No signal to weight by — distribute evenly, giving the remainder to the first columns.
    const base = Math.floor(total / weights.length);
    const shares = weights.map(() => base);
    for (let i = 0; i < total - base * weights.length; i++) shares[i] += 1;
    return shares;
  }

  const exact = weights.map((w) => (w / weightSum) * total);
  const shares = exact.map((value) => Math.floor(value));
  let remaining = total - shares.reduce((sum, s) => sum + s, 0);

  // Hand out the leftover units to the largest fractional parts, biggest first.
  const order = exact
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((a, b) => b.fraction - a.fraction || a.index - b.index);

  for (let i = 0; remaining > 0; i = (i + 1) % order.length) {
    shares[order[i].index] += 1;
    remaining -= 1;
  }
  return shares;
}

/**
 * The narrowest a column may be dragged, in grid units. The static `MIN_COLUMN_UNITS`
 * floor is ~13% of the grid, which on a wide display is still far too narrow for these
 * cards — so the real minimum is whatever `MIN_COLUMN_PX` works out to at this container
 * width. Floored by a fair share so a very narrow container cannot make the minimum
 * exceed what is actually available.
 */
export function minUnitsForWidth(containerWidthPx: number, columnCount: number): number {
  if (containerWidthPx <= 0) return MIN_COLUMN_UNITS;
  const fairShare = Math.floor(TOTAL_COLUMN_UNITS / columnCount);
  const pxDriven = Math.ceil((MIN_COLUMN_PX / containerWidthPx) * TOTAL_COLUMN_UNITS);
  return clamp(Math.max(MIN_COLUMN_UNITS, Math.min(pxDriven, fairShare)), 1, TOTAL_COLUMN_UNITS);
}

/**
 * Move `deltaUnits` of width across the boundary between column `index` and the one after
 * it. Only those two change, so the total is conserved by construction rather than by
 * re-normalising afterwards — which is what keeps repeated resizes from drifting.
 */
export function resizeAdjacent(
  columns: readonly DashboardColumn[],
  index: number,
  deltaUnits: number,
  minUnits: number = MIN_COLUMN_UNITS,
): DashboardColumn[] {
  const next = columns.map((column) => ({ ...column }));
  const left = next[index];
  const right = next[index + 1];
  if (!left || !right) return next;

  const floor = Math.max(1, minUnits);
  const clamped = clamp(Math.round(deltaUnits), floor - left.weight, right.weight - floor);
  left.weight += clamped;
  right.weight -= clamped;
  return next;
}

/**
 * Append an empty column, taking its width proportionally from the existing ones. Refuses
 * (returns the input unchanged) when the result could not give every column its minimum,
 * so the caller can disable the control rather than produce an unusable layout.
 */
export function redistributeOnAdd(
  columns: readonly DashboardColumn[],
  newColumnId: string,
): DashboardColumn[] {
  if (columns.length >= MAX_COLUMNS) return columns.map((column) => ({ ...column }));
  const count = columns.length + 1;
  if (count * MIN_COLUMN_UNITS > TOTAL_COLUMN_UNITS) return columns.map((column) => ({ ...column }));

  const shares = largestRemainder([...columns.map((c) => c.weight), TOTAL_COLUMN_UNITS / count], TOTAL_COLUMN_UNITS);
  const withNew = [
    ...columns.map((column, i) => ({ ...column, weight: shares[i] })),
    { id: newColumnId, weight: shares[shares.length - 1], slots: [] },
  ];
  return enforceMinimums(withNew);
}

/**
 * Remove a column, moving its cards to the neighbour on its left — or to the one on its
 * right when it was leftmost. They are never dropped: silently deleting someone's cards
 * because they narrowed their dashboard is the worst outcome this module can produce.
 * The last remaining column cannot be removed.
 */
export function redistributeOnRemove(
  columns: readonly DashboardColumn[],
  index: number,
): DashboardColumn[] {
  if (columns.length <= 1 || index < 0 || index >= columns.length) {
    return columns.map((column) => ({ ...column }));
  }

  const removed = columns[index];
  const kept = columns.filter((_, i) => i !== index).map((column) => ({ ...column }));
  const adoptIndex = index === 0 ? 0 : index - 1;
  // Keep reading order: cards from the leftmost column belong in front of the ones they
  // used to sit beside, cards from anywhere else belong after their new neighbour's.
  const adopted =
    index === 0
      ? [...removed.slots, ...kept[adoptIndex].slots]
      : [...kept[adoptIndex].slots, ...removed.slots];
  kept[adoptIndex] = { ...kept[adoptIndex], slots: adopted };

  const shares = largestRemainder(kept.map((c) => c.weight), TOTAL_COLUMN_UNITS);
  return enforceMinimums(kept.map((column, i) => ({ ...column, weight: shares[i] })));
}

/**
 * Bring every weight to at least the minimum while keeping the sum at exactly
 * `TOTAL_COLUMN_UNITS`, taking the shortfall from whichever column is currently widest.
 */
export function enforceMinimums(
  columns: readonly DashboardColumn[],
  minUnits: number = MIN_COLUMN_UNITS,
): DashboardColumn[] {
  const next = columns.map((column) => ({ ...column }));
  if (next.length === 0) return next;

  const floor = Math.min(minUnits, Math.floor(TOTAL_COLUMN_UNITS / next.length));

  // Make the sum exact first; the minimum pass below assumes it.
  const sum = next.reduce((acc, c) => acc + c.weight, 0);
  if (sum !== TOTAL_COLUMN_UNITS) {
    const shares = largestRemainder(next.map((c) => c.weight), TOTAL_COLUMN_UNITS);
    next.forEach((column, i) => {
      column.weight = shares[i];
    });
  }

  for (let guard = 0; guard < next.length * 2; guard++) {
    const needy = next.find((column) => column.weight < floor);
    if (!needy) break;
    const donor = next.reduce((widest, column) => (column.weight > widest.weight ? column : widest), next[0]);
    if (donor === needy || donor.weight - 1 < floor) break;
    donor.weight -= 1;
    needy.weight += 1;
  }
  return next;
}

/**
 * Merge `columns` down to `count` rendered columns, for when the viewport is too narrow to
 * show them all. Column `i` folds into bucket `floor(i * count / columns.length)`, so at
 * `count === 1` every slot ends up in one column in column-major order — the reading order
 * someone would expect from their own left-to-right arrangement.
 *
 * This is how the dashboard reaches one column without ever needing a horizontal scrollbar.
 */
export function collapseColumns(
  columns: readonly DashboardColumn[],
  count: number,
): DashboardColumn[] {
  const target = clamp(Math.floor(count), 1, columns.length);
  if (target === columns.length) return columns.map((column) => ({ ...column, slots: [...column.slots] }));

  const buckets: DashboardColumn[] = [];
  columns.forEach((column, i) => {
    const bucketIndex = Math.min(target - 1, Math.floor((i * target) / columns.length));
    const bucket = buckets[bucketIndex];
    if (!bucket) {
      buckets[bucketIndex] = { id: column.id, weight: column.weight, slots: [...column.slots] };
      return;
    }
    bucket.weight += column.weight;
    bucket.slots.push(...column.slots);
  });

  return buckets.filter(Boolean);
}
