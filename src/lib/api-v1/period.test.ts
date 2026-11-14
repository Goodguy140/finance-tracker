import { describe, expect, it } from "vitest";
import { parseAppPeriod, serializeAppPeriod } from "./period";

const now = new Date("2026-03-25T15:00:00Z");
const parse = (query: string) => parseAppPeriod(new URLSearchParams(query), "America/Toronto", now);

describe("parseAppPeriod", () => {
  it("reads a month, year to date and a custom range as the dashboard does", () => {
    const month = parse("");
    expect(month.ok && serializeAppPeriod(month.period)).toMatchObject({ range: "month", from: "2026-03-01", to: "2026-03-31" });
    const ytd = parse("range=ytd&month=2026-02");
    expect(ytd.ok && serializeAppPeriod(ytd.period)).toMatchObject({ range: "ytd", from: "2026-01-01", to: "2026-02-28" });
    const custom = parse("range=custom&from=2025-12-30&to=2026-01-15");
    expect(custom.ok && custom.period).toMatchObject({ range: "custom", ym: "2026-01" });
    expect(custom.ok && serializeAppPeriod(custom.period)).toMatchObject({ from: "2025-12-30", to: "2026-01-15" });
  });

  it("refuses what the dashboard would quietly show as this month", () => {
    for (const bad of ["month=2026-13", "range=lifetime", "range=custom", "range=custom&from=2026-02-01&to=2026-01-01", "range=custom&from=2026-02-30&to=2026-03-01"]) {
      expect(parse(bad)).toMatchObject({ ok: false });
    }
  });
});
