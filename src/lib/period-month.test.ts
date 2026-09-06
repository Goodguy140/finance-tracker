import { describe, expect, it } from "vitest";
import { currentYmdInTimeZone, currentYmInTimeZone, isValidYm, YM_PATTERN } from "./period-month";

describe("YM_PATTERN / isValidYm", () => {
  it("accepts real calendar months only", () => {
    expect(isValidYm("2026-01")).toBe(true);
    expect(isValidYm("2026-12")).toBe(true);
    expect(isValidYm("2026-13")).toBe(false);
    expect(isValidYm("2026-00")).toBe(false);
    expect(isValidYm("2026-1")).toBe(false);
    expect(isValidYm("26-01")).toBe(false);
    expect(isValidYm(undefined)).toBe(false);
    expect(YM_PATTERN.test("2026-06")).toBe(true);
  });
});

describe("currentYmInTimeZone", () => {
  // 2025-04-30T23:30 in Toronto (UTC-4 in April) is 2025-05-01T03:30Z, which is May 1 12:30 in Tokyo.
  const lateAprilToronto = new Date("2025-05-01T03:30:00.000Z");

  it("resolves the month in the requested zone", () => {
    expect(currentYmInTimeZone("America/Toronto", lateAprilToronto)).toBe("2025-04");
    expect(currentYmInTimeZone("Asia/Tokyo", lateAprilToronto)).toBe("2025-05");
    expect(currentYmInTimeZone("UTC", lateAprilToronto)).toBe("2025-05");
  });

  it("handles the year boundary", () => {
    const newYearsEveHonolulu = new Date("2026-01-01T09:30:00.000Z"); // 23:30 Dec 31 in Honolulu (UTC-10)
    expect(currentYmInTimeZone("Pacific/Honolulu", newYearsEveHonolulu)).toBe("2025-12");
    expect(currentYmInTimeZone("Europe/Berlin", newYearsEveHonolulu)).toBe("2026-01");
  });

  it("falls back to the host calendar for a missing or invalid zone", () => {
    const ref = new Date(2025, 4, 15, 12, 0, 0);
    expect(currentYmInTimeZone(null, ref)).toBe("2025-05");
    expect(currentYmInTimeZone("Not/AZone", ref)).toBe("2025-05");
  });
});

describe("currentYmdInTimeZone", () => {
  it("resolves the calendar day in the requested zone", () => {
    const instant = new Date("2025-05-01T03:30:00.000Z");
    expect(currentYmdInTimeZone("America/Toronto", instant)).toBe("2025-04-30");
    expect(currentYmdInTimeZone("Asia/Tokyo", instant)).toBe("2025-05-01");
  });

  it("falls back to the host calendar for an invalid zone", () => {
    const ref = new Date(2025, 4, 15, 12, 0, 0);
    expect(currentYmdInTimeZone("Not/AZone", ref)).toBe("2025-05-15");
    expect(currentYmdInTimeZone(undefined, ref)).toBe("2025-05-15");
  });
});
