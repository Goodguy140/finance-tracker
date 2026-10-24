import { describe, expect, it } from "vitest";
import { formatCustomRange, parseCustomRange, parseCustomRangeKey } from "./date-range";

describe("custom date ranges", () => {
  it("accepts two real days in order and nothing else", () => {
    expect(parseCustomRange("2026-10-03", "2026-10-20")).toEqual({ fromYmd: "2026-10-03", toYmd: "2026-10-20" });
    expect(parseCustomRange("2026-10-20", "2026-10-03")).toBeNull();
    expect(parseCustomRange("2026-02-30", "2026-03-05")).toBeNull();
    expect(parseCustomRange("2026-10-03", undefined)).toBeNull();
    expect(parseCustomRange("1990-01-01", "2026-01-01")).toBeNull();
    expect(parseCustomRangeKey("2026-10-03_2026-10-20")).toEqual({ fromYmd: "2026-10-03", toYmd: "2026-10-20" });
    expect(parseCustomRangeKey("2026")).toBeNull();
  });

  it("labels a range without repeating what both ends share", () => {
    expect(formatCustomRange({ fromYmd: "2026-10-03", toYmd: "2026-10-20" })).toBe("Oct 3 – 20, 2026");
    expect(formatCustomRange({ fromYmd: "2026-09-28", toYmd: "2026-10-04" })).toBe("Sep 28 – Oct 4, 2026");
    expect(formatCustomRange({ fromYmd: "2025-12-20", toYmd: "2026-01-05" })).toBe("Dec 20, 2025 – Jan 5, 2026");
  });
});
