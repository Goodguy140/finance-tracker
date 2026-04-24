/** Calendar month as `YYYY-MM` (UTC-agnostic; interpreted in local sense via Date parts). */
export type DashboardMonthMode = { kind: "month"; ym: string } | { kind: "all" };

export function currentPeriodYm(reference = new Date()): string {
  return `${reference.getFullYear()}-${String(reference.getMonth() + 1).padStart(2, "0")}`;
}

export function parseDashboardMonthParam(
  monthParam: string | string[] | undefined,
  reference = new Date(),
): DashboardMonthMode {
  const raw = Array.isArray(monthParam) ? monthParam[0] : monthParam;
  if (raw === "all") return { kind: "all" };
  if (raw && /^\d{4}-\d{2}$/.test(raw)) return { kind: "month", ym: raw };
  return { kind: "month", ym: currentPeriodYm(reference) };
}

export function startOfMonthYm(ym: string): Date {
  const [y, m] = ym.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1, 0, 0, 0, 0));
}

/** First instant after the last day of `ym`. */
export function endExclusiveOfMonthYm(ym: string): Date {
  const [y, m] = ym.split("-").map(Number);
  return new Date(Date.UTC(y, m, 1, 0, 0, 0, 0));
}
