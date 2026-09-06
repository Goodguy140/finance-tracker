/**
 * Calendar-month (`YYYY-MM`) helpers with no other dependencies, so validation schemas
 * and route handlers can share them without pulling in the dashboard module.
 */

/** A real calendar month: four-digit year and a month in 01–12. */
export const YM_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

export function isValidYm(value: string | undefined | null): value is string {
  return typeof value === "string" && YM_PATTERN.test(value);
}

function ymFromLocalFields(reference: Date): string {
  return `${reference.getFullYear()}-${String(reference.getMonth() + 1).padStart(2, "0")}`;
}

/**
 * The calendar month `reference` falls in for someone living in `timeZone`.
 *
 * Month boundaries differ by zone: 23:30 on April 30 in Toronto is already May 1 in Tokyo.
 * Every user has a stored IANA zone, so "this month" for budgets and the dashboard is
 * resolved through it rather than through the container's clock. An unknown zone falls
 * back to the host's local calendar, which is what every caller used before.
 */
export function currentYmInTimeZone(timeZone: string | null | undefined, reference = new Date()): string {
  if (!timeZone) return ymFromLocalFields(reference);
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
    }).formatToParts(reference);
    const year = parts.find((p) => p.type === "year")?.value;
    const month = parts.find((p) => p.type === "month")?.value;
    if (year && month) return `${year}-${month}`;
  } catch {
    // RangeError for an unrecognised zone: fall through to the host calendar.
  }
  return ymFromLocalFields(reference);
}

function ymdFromLocalFields(reference: Date): string {
  return `${reference.getFullYear()}-${String(reference.getMonth() + 1).padStart(2, "0")}-${String(reference.getDate()).padStart(2, "0")}`;
}

/** The calendar day (`YYYY-MM-DD`) `reference` falls on in `timeZone`; host calendar for an unknown zone. */
export function currentYmdInTimeZone(timeZone: string | null | undefined, reference = new Date()): string {
  if (!timeZone) return ymdFromLocalFields(reference);
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(reference);
    const pick = (type: string) => parts.find((p) => p.type === type)?.value;
    const year = pick("year");
    const month = pick("month");
    const day = pick("day");
    if (year && month && day) return `${year}-${month}-${day}`;
  } catch {
    // RangeError for an unrecognised zone: fall through to the host calendar.
  }
  return ymdFromLocalFields(reference);
}
