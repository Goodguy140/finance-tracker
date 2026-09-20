import { describe, expect, it } from "vitest";
import {
  DEFAULT_PLAID_SYNC_INTERVAL_MINUTES,
  MIN_PLAID_SYNC_INTERVAL_MINUTES,
  MAX_SYNC_BACKOFF_MINUTES,
  plaidSyncBackoffMinutes,
  plaidSyncDueBefore,
  plaidSyncSchedulerEnabled,
  resolvePlaidSyncIntervalMinutes,
} from "./plaid-sync-scheduler";

describe("plaidSyncSchedulerEnabled", () => {
  it("is on unless explicitly switched off", () => {
    expect(plaidSyncSchedulerEnabled({})).toBe(true);
    expect(plaidSyncSchedulerEnabled({ PLAID_SYNC_SCHEDULER: "true" })).toBe(true);
    expect(plaidSyncSchedulerEnabled({ PLAID_SYNC_SCHEDULER: "false" })).toBe(false);
    expect(plaidSyncSchedulerEnabled({ PLAID_SYNC_SCHEDULER: " 0 " })).toBe(false);
    expect(plaidSyncSchedulerEnabled({ PLAID_SYNC_SCHEDULER: "FALSE" })).toBe(false);
  });
});

describe("resolvePlaidSyncIntervalMinutes", () => {
  it("defaults when unset", () => {
    expect(resolvePlaidSyncIntervalMinutes({})).toBe(DEFAULT_PLAID_SYNC_INTERVAL_MINUTES);
    expect(resolvePlaidSyncIntervalMinutes({ PLAID_SYNC_INTERVAL_MINUTES: "  " })).toBe(
      DEFAULT_PLAID_SYNC_INTERVAL_MINUTES,
    );
  });

  it("accepts a value at or above the floor", () => {
    expect(resolvePlaidSyncIntervalMinutes({ PLAID_SYNC_INTERVAL_MINUTES: "15" })).toBe(15);
    expect(resolvePlaidSyncIntervalMinutes({ PLAID_SYNC_INTERVAL_MINUTES: " 240 " })).toBe(240);
    expect(resolvePlaidSyncIntervalMinutes({ PLAID_SYNC_INTERVAL_MINUTES: "1440" })).toBe(1440);
  });

  it("falls back rather than clamping up when the value is below the floor", () => {
    // Reinterpreting "5" as 15 would silently do something the operator did not ask for.
    // Treating it as unset is at least a behaviour they can recognise and correct.
    expect(resolvePlaidSyncIntervalMinutes({ PLAID_SYNC_INTERVAL_MINUTES: "5" })).toBe(
      DEFAULT_PLAID_SYNC_INTERVAL_MINUTES,
    );
    expect(MIN_PLAID_SYNC_INTERVAL_MINUTES).toBe(15);
  });

  it("falls back for anything that is not a sensible number", () => {
    for (const raw of ["0", "-30", "abc", "1.5.2", "NaN", "Infinity"]) {
      expect(resolvePlaidSyncIntervalMinutes({ PLAID_SYNC_INTERVAL_MINUTES: raw })).toBe(
        DEFAULT_PLAID_SYNC_INTERVAL_MINUTES,
      );
    }
  });
});

describe("plaidSyncDueBefore", () => {
  const now = new Date("2026-09-19T12:00:00Z");

  // The sweep selects `lastSyncedAt: null OR lastSyncedAt < dueBefore`, so these assert
  // the boundary the query will actually apply.
  it("puts the cutoff one interval behind now", () => {
    expect(plaidSyncDueBefore(now, 60).toISOString()).toBe("2026-09-19T11:00:00.000Z");
    expect(plaidSyncDueBefore(now, 15).toISOString()).toBe("2026-09-19T11:45:00.000Z");
    expect(plaidSyncDueBefore(now, 1440).toISOString()).toBe("2026-09-18T12:00:00.000Z");
  });

  it("selects a bank last synced before the cutoff, and not one synced after", () => {
    const cutoff = plaidSyncDueBefore(now, 60);
    expect(new Date("2026-09-19T10:59:59Z") < cutoff).toBe(true);
    expect(new Date("2026-09-19T11:00:01Z") < cutoff).toBe(false);
    // A clock skew into the future must not read as overdue.
    expect(new Date("2026-09-19T13:00:00Z") < cutoff).toBe(false);
  });
});

describe("plaidSyncBackoffMinutes", () => {
  it("doubles per consecutive failure, starting at the normal interval", () => {
    expect(plaidSyncBackoffMinutes(1)).toBe(60);
    expect(plaidSyncBackoffMinutes(2)).toBe(120);
    expect(plaidSyncBackoffMinutes(3)).toBe(240);
    expect(plaidSyncBackoffMinutes(4)).toBe(480);
  });

  it("caps at a day, so a connection fixed later is still picked up promptly", () => {
    // 60 · 2^4 = 960, still under the cap; the cap first bites on the sixth failure.
    expect(plaidSyncBackoffMinutes(5)).toBe(960);
    expect(plaidSyncBackoffMinutes(6)).toBe(MAX_SYNC_BACKOFF_MINUTES);
    expect(plaidSyncBackoffMinutes(50)).toBe(MAX_SYNC_BACKOFF_MINUTES);
    // No overflow from a runaway counter.
    expect(Number.isFinite(plaidSyncBackoffMinutes(10_000))).toBe(true);
    expect(plaidSyncBackoffMinutes(10_000)).toBe(MAX_SYNC_BACKOFF_MINUTES);
  });

  it("treats a first failure and a zeroed counter the same", () => {
    expect(plaidSyncBackoffMinutes(0)).toBe(60);
    expect(plaidSyncBackoffMinutes(-3)).toBe(60);
  });

  it("turns a permanently broken bank from 24 calls a day into 1", () => {
    // The whole point: a connection nobody fixes must stop costing rate limit, and on
    // per-request pricing, money.
    const callsPerDayAtCap = (24 * 60) / plaidSyncBackoffMinutes(6);
    expect(callsPerDayAtCap).toBe(1);
  });
});
