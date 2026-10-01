import { describe, expect, it } from "vitest";
import type { SweepSummary } from "@/lib/plaid-sync-scheduler";
import { describeLogRefresh } from "@/lib/plaid/log-refresh";

const EMPTY: SweepSummary = { considered: 0, synced: 0, staged: 0, busy: 0, needsReauth: 0, failed: 0 };

describe("describeLogRefresh", () => {
  it("says why nothing ran when no bank was due", () => {
    const result = describeLogRefresh(EMPTY);
    expect(result.tone).toBe("neutral");
    expect(result.message).toMatch(/checked in the last 15 minutes/);
  });

  it("counts what landed in the review queue", () => {
    expect(describeLogRefresh({ ...EMPTY, considered: 2, synced: 2, staged: 3 })).toEqual({
      ok: true,
      tone: "success",
      message: "3 new transactions to review.",
    });
    expect(describeLogRefresh({ ...EMPTY, considered: 1, synced: 1, staged: 1 }).message).toBe(
      "1 new transaction to review.",
    );
  });

  it("says so when a sync found nothing new", () => {
    expect(describeLogRefresh({ ...EMPTY, considered: 1, synced: 1 })).toMatchObject({
      tone: "neutral",
      message: "No new transactions.",
    });
  });

  it("reports each bank that did not sync, and warns when one needs the user", () => {
    const result = describeLogRefresh({ ...EMPTY, considered: 4, synced: 1, staged: 2, busy: 1, needsReauth: 1, failed: 1 });
    expect(result.tone).toBe("warning");
    expect(result.message).toBe(
      "2 new transactions to review. 1 bank was already syncing. 1 bank needs you to sign in again in Settings. 1 bank could not be reached. Try again later.",
    );
  });

  it("does not claim 'no new transactions' when no bank actually synced", () => {
    const result = describeLogRefresh({ ...EMPTY, considered: 2, failed: 2 });
    expect(result.message).toBe("2 banks could not be reached. Try again later.");
    expect(result.tone).toBe("warning");
  });
});
