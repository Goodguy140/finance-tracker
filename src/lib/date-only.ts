const YMD = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Parses a calendar date from an HTML &lt;input type="date"&gt; value (`YYYY-MM-DD`).
 * Using `new Date("YYYY-MM-DD")` is UTC midnight and shifts the civil day in many timezones.
 */
export function dateFromYmd(ymd: string): Date {
  const m = YMD.exec(ymd.trim());
  if (!m) return new Date(ymd);
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  return new Date(Date.UTC(y, mo - 1, d));
}

/** Inverse of {@link dateFromYmd} for populating date inputs from stored values. */
export function ymdFromDateUtc(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

export function formatDateOnlyUtc(d: Date, locale?: string): string {
  return d.toLocaleDateString(locale ?? undefined, {
    timeZone: "UTC",
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}
