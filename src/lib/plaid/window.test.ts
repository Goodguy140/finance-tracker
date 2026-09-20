import { describe, expect, it } from "vitest";
import { ymdFromDateUtc } from "@/lib/date-only";
import {
  describeHistorySetting,
  describeHistoryWindow,
  describeShortfall,
  HISTORY_WINDOWS,
  historyWindowLabel,
  isBeforeCutoff,
  parseHistoryWindowDays,
  resolveHistoryCutoff,
} from "@/lib/plaid/window";

const TORONTO = "America/Toronto";

describe("resolveHistoryCutoff", () => {
  it("counts back from today in the user's timezone, not UTC's", () => {
    // 21:00 in Toronto on the 18th is already the 19th in UTC. Counting from the UTC day
    // would quietly shift every window by one, so day zero must be the user's own date.
    const evening = new Date("2026-09-18T21:00:00-04:00");
    expect(ymdFromDateUtc(resolveHistoryCutoff(30, TORONTO, evening))).toBe("2026-08-19");
  });

  it("returns UTC midnight, matching how every calendar date is stored", () => {
    const cutoff = resolveHistoryCutoff(30, TORONTO, new Date("2026-09-18T12:00:00Z"));
    expect(cutoff.getUTCHours()).toBe(0);
    expect(cutoff.getUTCMinutes()).toBe(0);
    expect(cutoff.getUTCSeconds()).toBe(0);
    expect(cutoff.getUTCMilliseconds()).toBe(0);
  });

  it("handles each supported window", () => {
    const ref = new Date("2026-09-18T12:00:00Z");
    expect(ymdFromDateUtc(resolveHistoryCutoff(30, TORONTO, ref))).toBe("2026-08-19");
    expect(ymdFromDateUtc(resolveHistoryCutoff(90, TORONTO, ref))).toBe("2026-06-20");
    expect(ymdFromDateUtc(resolveHistoryCutoff(365, TORONTO, ref))).toBe("2025-09-18");
    // 730 days back from 2026-09-18 is exactly 2024-09-18: neither 2025 nor 2026 is a
    // leap year, so the two years are 365 days each.
    expect(ymdFromDateUtc(resolveHistoryCutoff(730, TORONTO, ref))).toBe("2024-09-18");
  });

  it("crosses a DST boundary without losing or gaining a day", () => {
    // Toronto leaves DST on 2026-11-01. Counting 30 days back from 2026-11-15 spans it.
    const ref = new Date("2026-11-15T12:00:00Z");
    expect(ymdFromDateUtc(resolveHistoryCutoff(30, TORONTO, ref))).toBe("2026-10-16");
  });

  it("counts correctly across a leap day", () => {
    // 2028 is a leap year: 2028-03-01 minus 30 days must land on 01-31, not 02-01.
    const ref = new Date("2028-03-01T12:00:00Z");
    expect(ymdFromDateUtc(resolveHistoryCutoff(30, TORONTO, ref))).toBe("2028-01-31");
  });

  it("falls back sanely when the timezone is missing or nonsense", () => {
    const ref = new Date("2026-09-18T12:00:00Z");
    expect(() => resolveHistoryCutoff(30, null, ref)).not.toThrow();
    expect(() => resolveHistoryCutoff(30, "Not/AZone", ref)).not.toThrow();
  });
});

describe("parseHistoryWindowDays", () => {
  it("accepts every offered window", () => {
    for (const w of HISTORY_WINDOWS) {
      expect(parseHistoryWindowDays(String(w.days))).toBe(w.days);
    }
  });

  it("falls back to 90 days for anything unrecognised", () => {
    // Conservative on purpose: a bad value must not silently request two years.
    for (const raw of ["", "  ", "abc", "0", "-30", "731", "45", null, undefined]) {
      expect(parseHistoryWindowDays(raw)).toBe(90);
    }
  });
});

describe("copy", () => {
  const cutoff = new Date(Date.UTC(2024, 8, 18));

  it("names the exact date and admits the bank may return less", () => {
    const text = describeHistoryWindow(730, cutoff, "en-CA");
    expect(text).toContain("Sep 18, 2024");
    expect(text).toContain("may return less");
  });

  it("states the window and its cutoff together", () => {
    expect(describeHistorySetting(730, cutoff, "en-CA")).toContain("24 months");
    expect(describeHistorySetting(730, cutoff, "en-CA")).toContain("Sep 18, 2024");
  });

  it("labels known windows and degrades gracefully for others", () => {
    expect(historyWindowLabel(365)).toBe("12 months");
    expect(historyWindowLabel(123)).toBe("123 days");
  });
});

describe("describeShortfall", () => {
  const requestedCutoff = new Date(Date.UTC(2024, 8, 18));
  const base = {
    institutionName: "RBC",
    requestedDays: 730,
    requestedCutoff,
    locale: "en-CA",
  };

  it("is silent before the first sync has finished", () => {
    expect(describeShortfall({ ...base, earliestObserved: null })).toBeNull();
  });

  it("is silent when the bank returned everything asked for", () => {
    expect(describeShortfall({ ...base, earliestObserved: requestedCutoff })).toBeNull();
  });

  it("is silent for a quiet first week rather than crying wolf", () => {
    // No activity in the opening days is not a shortfall; warning here would fire on
    // healthy items and train people to ignore the message that matters.
    const sixDaysLater = new Date(Date.UTC(2024, 8, 24));
    expect(describeShortfall({ ...base, earliestObserved: sixDaysLater })).toBeNull();
  });

  it("reports a genuine shortfall with both dates", () => {
    const muchLater = new Date(Date.UTC(2025, 2, 12));
    const text = describeShortfall({ ...base, earliestObserved: muchLater });
    expect(text).not.toBeNull();
    expect(text).toContain("24 months");
    expect(text).toContain("Sep 18, 2024");
    expect(text).toContain("Mar 12, 2025");
    expect(text).toContain("RBC");
  });

  it("does not say 'null' when the institution name is unknown", () => {
    const text = describeShortfall({
      ...base,
      institutionName: null,
      earliestObserved: new Date(Date.UTC(2025, 2, 12)),
    });
    expect(text).toContain("Your bank");
    expect(text).not.toContain("null");
  });

  it("respects a custom grace window at its exact boundary", () => {
    const twoDaysLater = new Date(Date.UTC(2024, 8, 20));
    expect(
      describeShortfall({ ...base, earliestObserved: twoDaysLater, graceDays: 2 }),
    ).toBeNull();
    const threeDaysLater = new Date(Date.UTC(2024, 8, 21));
    expect(
      describeShortfall({ ...base, earliestObserved: threeDaysLater, graceDays: 2 }),
    ).not.toBeNull();
  });
});

describe("isBeforeCutoff", () => {
  const cutoff = new Date(Date.UTC(2026, 0, 15));

  it("excludes older transactions and keeps the cutoff day itself", () => {
    expect(isBeforeCutoff(new Date(Date.UTC(2026, 0, 14)), cutoff)).toBe(true);
    // Inclusive: the cutoff is the oldest date the user asked for, not the first excluded.
    expect(isBeforeCutoff(new Date(Date.UTC(2026, 0, 15)), cutoff)).toBe(false);
    expect(isBeforeCutoff(new Date(Date.UTC(2026, 0, 16)), cutoff)).toBe(false);
  });
});
