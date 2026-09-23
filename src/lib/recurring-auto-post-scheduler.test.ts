import { describe, expect, it, vi } from "vitest";
import { recurringAutoPostSchedulerEnabled, runRecurringAutoPostTick } from "./recurring-auto-post-scheduler";

describe("recurringAutoPostSchedulerEnabled", () => {
  it("is on unless explicitly switched off", () => {
    expect(recurringAutoPostSchedulerEnabled({})).toBe(true);
    expect(recurringAutoPostSchedulerEnabled({ RECURRING_AUTO_POST_SCHEDULER: "true" })).toBe(true);
    expect(recurringAutoPostSchedulerEnabled({ RECURRING_AUTO_POST_SCHEDULER: "false" })).toBe(false);
    expect(recurringAutoPostSchedulerEnabled({ RECURRING_AUTO_POST_SCHEDULER: " 0 " })).toBe(false);
  });
});

describe("runRecurringAutoPostTick", () => {
  it("skips posting while the admin switch is off", async () => {
    const post = vi.fn(async () => 3);
    const result = await runRecurringAutoPostTick({ enabled: async () => false, post });
    expect(post).not.toHaveBeenCalled();
    expect(result).toMatchObject({ ok: true, posted: 0 });
    expect(result.message).toMatch(/Skipped/);
  });

  it("posts and reports the count while it is on", async () => {
    const post = vi.fn(async () => 3);
    const result = await runRecurringAutoPostTick({ enabled: async () => true, post });
    expect(post).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ ok: true, posted: 3 });
  });
});
