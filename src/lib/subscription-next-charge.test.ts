import { describe, expect, it } from "vitest";
import { dateFromYmd } from "./date-only";
import { computeRolledForwardNextChargeDate } from "./subscription-next-charge";

describe("computeRolledForwardNextChargeDate", () => {
  it("leaves a future charge date unchanged", () => {
    const now = dateFromYmd("2026-06-01");
    const next = dateFromYmd("2026-07-15");
    const rolled = computeRolledForwardNextChargeDate(next, "MONTHLY", now);
    expect(rolled.getTime()).toBe(next.getTime());
  });

  it("rolls weekly charges forward until on or after today (UTC)", () => {
    const now = dateFromYmd("2026-05-10");
    const past = dateFromYmd("2026-05-01");
    const rolled = computeRolledForwardNextChargeDate(past, "WEEKLY", now);
    expect(rolled.toISOString()).toMatch(/^2026-05-15/);
  });

  it("rolls monthly charges across multiple missed months", () => {
    const now = dateFromYmd("2026-05-03");
    const past = dateFromYmd("2025-01-15");
    const rolled = computeRolledForwardNextChargeDate(past, "MONTHLY", now);
    expect(rolled.toISOString()).toMatch(/^2026-05-15/);
  });

  it("keeps today as next charge without rolling forward", () => {
    const now = dateFromYmd("2026-05-03");
    const todayCharge = dateFromYmd("2026-05-03");
    const rolled = computeRolledForwardNextChargeDate(todayCharge, "MONTHLY", now);
    expect(rolled.getTime()).toBe(todayCharge.getTime());
  });
});
