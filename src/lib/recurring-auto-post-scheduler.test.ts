import { describe, expect, it } from "vitest";
import { recurringAutoPostSchedulerEnabled } from "./recurring-auto-post-scheduler";

describe("recurringAutoPostSchedulerEnabled", () => {
  it("is on unless explicitly switched off", () => {
    expect(recurringAutoPostSchedulerEnabled({})).toBe(true);
    expect(recurringAutoPostSchedulerEnabled({ RECURRING_AUTO_POST_SCHEDULER: "true" })).toBe(true);
    expect(recurringAutoPostSchedulerEnabled({ RECURRING_AUTO_POST_SCHEDULER: "false" })).toBe(false);
    expect(recurringAutoPostSchedulerEnabled({ RECURRING_AUTO_POST_SCHEDULER: " 0 " })).toBe(false);
  });
});
