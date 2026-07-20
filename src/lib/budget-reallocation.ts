/**
 * Pure planner for covering a budget overage by pulling from other budgets.
 *
 * Given the current-month budget rows (limit + spend per category), a destination
 * category that is over its limit, and a set of source transfers, this validates
 * the request and returns the new per-category limits to persist. The server
 * action stays thin: it fetches rows, calls this, and upserts the results.
 */

export type ReallocationRow = {
  categoryId: string;
  categoryName: string;
  spentCents: number;
  limitCents: number;
};

export type ReallocationTransfer = {
  categoryId: string;
  amountCents: number;
};

export type ReallocationUpdate = {
  categoryId: string;
  newLimitCents: number;
};

/** Amount a category is over its limit (0 if within budget). */
export function overageCents(row: Pick<ReallocationRow, "spentCents" | "limitCents">): number {
  return Math.max(0, row.spentCents - row.limitCents);
}

/** Unspent room in a budget, floored at 0 — the most that can be taken from it. */
export function headroomCents(row: Pick<ReallocationRow, "spentCents" | "limitCents">): number {
  return Math.max(0, row.limitCents - row.spentCents);
}

/**
 * Validate a reallocation and return the limit updates to apply (destination +
 * one per source). Throws `Error` with a user-facing message on invalid input.
 */
export function computeReallocationPlan(
  rows: ReallocationRow[],
  destinationCategoryId: string,
  transfers: ReallocationTransfer[],
): ReallocationUpdate[] {
  const rowByCategory = new Map(rows.map((row) => [row.categoryId, row]));

  const destination = rowByCategory.get(destinationCategoryId);
  if (!destination) {
    throw new Error("The over-budget category no longer has a budget for this month.");
  }

  const overage = overageCents(destination);
  if (overage <= 0) {
    throw new Error(`${destination.categoryName} is no longer over budget.`);
  }

  if (transfers.length === 0) {
    throw new Error("Choose at least one budget to cover the overage from.");
  }

  const seen = new Set<string>();
  let total = 0;
  const sourceUpdates: ReallocationUpdate[] = [];

  for (const transfer of transfers) {
    if (transfer.categoryId === destinationCategoryId) {
      throw new Error("A budget can't cover its own overage.");
    }
    if (seen.has(transfer.categoryId)) {
      throw new Error("Each source budget can only be used once.");
    }
    seen.add(transfer.categoryId);

    if (!Number.isInteger(transfer.amountCents) || transfer.amountCents <= 0) {
      throw new Error("Transfer amounts must be positive.");
    }

    const source = rowByCategory.get(transfer.categoryId);
    if (!source) {
      throw new Error("One of the selected source budgets no longer exists for this month.");
    }

    const available = headroomCents(source);
    if (transfer.amountCents > available) {
      throw new Error(
        `${source.categoryName} only has ${(available / 100).toFixed(2)} left to give.`,
      );
    }

    total += transfer.amountCents;
    sourceUpdates.push({
      categoryId: source.categoryId,
      newLimitCents: source.limitCents - transfer.amountCents,
    });
  }

  if (total > overage) {
    throw new Error("You can't transfer more than the overage amount.");
  }

  return [
    { categoryId: destination.categoryId, newLimitCents: destination.limitCents + total },
    ...sourceUpdates,
  ];
}
