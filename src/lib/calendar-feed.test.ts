import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { copyMigratedDatabase } from "@/test-support/migrated-db";
import { buildCalendarIcs, calendarFeedEvents, foldIcsLine, type CalendarFeedRule } from "./calendar-feed";
import { dateFromYmd } from "./date-only";

function rule(overrides: Partial<CalendarFeedRule>): CalendarFeedRule {
  return {
    id: "r1",
    type: "EXPENSE",
    name: "Rent",
    amountCents: 120_000,
    cadence: "MONTHLY",
    nextExpectedDate: dateFromYmd("2026-11-01"),
    anchorDay: 1,
    secondAnchorDay: null,
    beforeWeekend: false,
    endDate: null,
    enabled: true,
    decideBy: null,
    cancelUrl: null,
    note: null,
    account: { name: "Chequing", currency: "CAD" },
    transferAccount: null,
    ...overrides,
  };
}

const today = { todayYmd: "2026-10-28", currentYm: "2026-10" };

describe("calendarFeedEvents", () => {
  it("lists each bill, payday and transfer ahead with its amount, and decide-by dates", () => {
    const events = calendarFeedEvents(
      [
        rule({}),
        rule({
          id: "pay",
          type: "INCOME",
          name: "Paycheque",
          amountCents: 250_000,
          cadence: "SEMI_MONTHLY",
          nextExpectedDate: dateFromYmd("2026-11-13"),
          anchorDay: 15,
          secondAnchorDay: 31,
          beforeWeekend: true,
        }),
        rule({
          id: "save",
          type: "TRANSFER",
          name: "Savings top-up",
          amountCents: 50_000,
          nextExpectedDate: dateFromYmd("2026-11-02"),
          anchorDay: 2,
          transferAccount: { name: "Savings" },
        }),
        rule({
          id: "tv",
          name: "Streaming",
          amountCents: 1899,
          nextExpectedDate: dateFromYmd("2026-11-05"),
          anchorDay: 5,
          decideBy: dateFromYmd("2026-11-03"),
          cancelUrl: "https://example.test/cancel",
        }),
      ],
      { ...today, days: 33 },
    );
    expect(events.map((e) => [e.dateYmd, e.summary])).toEqual([
      ["2026-11-01", "Rent $1,200.00"],
      ["2026-11-02", "Savings top-up $500.00 to Savings"],
      ["2026-11-03", "Decide: keep Streaming? ($18.99)"],
      ["2026-11-05", "Streaming $18.99"],
      // Twice a month, Nov 15 (a Sunday) moved to the Friday before, then Nov 30.
      ["2026-11-13", "Paycheque +$2,500.00"],
      ["2026-11-30", "Paycheque +$2,500.00"],
    ]);
    expect(events.find((e) => e.summary.startsWith("Decide"))?.description).toContain("https://example.test/cancel");
    // The same occurrence keeps its id between fetches, so a calendar updates it in place.
    expect(events[0].uid).toBe("r1-2026-11-01@finance-tracker");
  });

  it("leaves out what is not coming: an unposted date before today, a passed decide-by, a rule turned off", () => {
    const events = calendarFeedEvents(
      [
        rule({ nextExpectedDate: dateFromYmd("2026-10-05"), anchorDay: 5, decideBy: dateFromYmd("2026-10-20") }),
        rule({ id: "off", name: "Gym", enabled: false }),
      ],
      { ...today, days: 30 },
    );
    expect(events.map((e) => [e.dateYmd, e.summary])).toEqual([["2026-11-05", "Rent $1,200.00"]]);
  });
});

describe("buildCalendarIcs", () => {
  it("writes all-day events ending the next day, escaped, with CRLF line ends", () => {
    const ics = buildCalendarIcs(
      [{ uid: "a@x", dateYmd: "2026-12-31", summary: "Hydro, gas; water", description: "Line one\nLine two" }],
      new Date("2026-10-28T12:00:00Z"),
    );
    const lines = ics.split("\r\n");
    expect(lines[0]).toBe("BEGIN:VCALENDAR");
    expect(lines).toContain("DTSTART;VALUE=DATE:20261231");
    expect(lines).toContain("DTEND;VALUE=DATE:20270101");
    expect(lines).toContain("DTSTAMP:20261028T120000Z");
    expect(lines).toContain("SUMMARY:Hydro\\, gas\\; water");
    expect(lines).toContain("DESCRIPTION:Line one\\nLine two");
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
  });

  it("folds a long line at 75 octets without splitting a character", () => {
    const line = `SUMMARY:${"é".repeat(60)}`;
    const folded = foldIcsLine(line).split("\r\n ");
    expect(folded.length).toBeGreaterThan(1);
    expect(folded.every((part) => Buffer.byteLength(part, "utf8") <= 75)).toBe(true);
    expect(folded.join("")).toBe(line);
  });
});

describe("GET /api/calendar/<secret>.ics", () => {
  const dir = mkdtempSync(join(tmpdir(), "calendar-feed-"));
  const url = `file:${join(dir, "calendar.db")}`;
  let db: PrismaClient;
  let GET: typeof import("@/app/api/calendar/[token]/route").GET;
  let feed: typeof import("./calendar-feed");

  beforeAll(async () => {
    copyMigratedDatabase(url);
    process.env.DATABASE_URL = url;
    ({ prisma: db } = await import("@/lib/prisma"));
    ({ GET } = await import("@/app/api/calendar/[token]/route"));
    feed = await import("./calendar-feed");
  });

  afterAll(async () => {
    await db?.$disconnect();
    rmSync(dir, { recursive: true, force: true });
  });

  const fetchFeed = (raw: string) =>
    GET(new Request(`http://localhost${feed.calendarFeedPath(raw)}`), { params: Promise.resolve({ token: `${raw}.ics` }) });

  it("serves the owner's rules for the current secret only, and notes the fetch", async () => {
    const user = await db.user.create({ data: { email: "cal@example.test", displayName: "Cal" } });
    const account = await db.account.create({ data: { userId: user.id, name: "Chequing", type: "CHEQUING" } });
    const category = await db.category.create({ data: { userId: user.id, name: "Housing", kind: "EXPENSE" } });
    const next = new Date();
    next.setUTCDate(next.getUTCDate() + 10);
    await db.recurringTransaction.create({
      data: {
        userId: user.id,
        accountId: account.id,
        categoryId: category.id,
        type: "EXPENSE",
        name: "Rent",
        amountCents: 120_000,
        cadence: "MONTHLY",
        nextExpectedDate: dateFromYmd(next.toISOString().slice(0, 10)),
      },
    });

    const first = feed.generateCalendarFeedToken();
    await db.calendarFeed.create({ data: { userId: user.id, tokenHash: first.hash } });
    const response = await fetchFeed(first.raw);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/calendar");
    expect(await response.text()).toContain("SUMMARY:Rent $1\\,200.00");
    expect((await db.calendarFeed.findUniqueOrThrow({ where: { userId: user.id } })).lastFetchedAt).not.toBeNull();

    // A new link replaces the old one, which then finds nothing.
    const second = feed.generateCalendarFeedToken();
    await db.calendarFeed.update({ where: { userId: user.id }, data: { tokenHash: second.hash } });
    expect((await fetchFeed(first.raw)).status).toBe(404);
    expect((await fetchFeed(second.raw)).status).toBe(200);

    // A suspended account's link stops too.
    await db.user.update({ where: { id: user.id }, data: { disabledAt: new Date() } });
    expect((await fetchFeed(second.raw)).status).toBe(404);
  });
});
