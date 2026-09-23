import { describe, expect, it, vi } from "vitest";
import {
  bucketByDay,
  dayKeys,
  getAdminAnalyticsSeries,
  getAdminAdoptionStats,
  parseAnalyticsRange,
  rangeStart,
} from "./admin-analytics-series";

const now = new Date("2026-09-22T15:30:00Z");

describe("day buckets", () => {
  it("covers the range ending today, oldest first", () => {
    expect(dayKeys(3, now)).toEqual(["2026-09-20", "2026-09-21", "2026-09-22"]);
    expect(rangeStart(3, now).toISOString()).toBe("2026-09-20T00:00:00.000Z");
  });

  it("zero-fills quiet days and ignores timestamps outside the range", () => {
    const counts = bucketByDay(
      [
        new Date("2026-09-20T00:00:00Z"),
        new Date("2026-09-20T23:59:59Z"),
        new Date("2026-09-22T01:00:00Z"),
        new Date("2026-09-19T23:59:59Z"),
        new Date("2026-09-23T00:00:00Z"),
      ],
      3,
      now,
    );
    expect(counts).toEqual([2, 0, 1]);
  });
});

describe("parseAnalyticsRange", () => {
  it("accepts only the offered ranges", () => {
    expect(parseAnalyticsRange("7")).toBe(7);
    expect(parseAnalyticsRange(["90"])).toBe(90);
    expect(parseAnalyticsRange("365")).toBe(30);
    expect(parseAnalyticsRange(undefined)).toBe(30);
  });
});

/** A Prisma stand-in that records every call and answers with empty results. */
function recordingPrisma() {
  const calls: { model: string; method: string; args: unknown }[] = [];
  const handler: ProxyHandler<object> = {
    get(_target, model: string) {
      return new Proxy(
        {},
        {
          get(_t, method: string) {
            return vi.fn(async (args: unknown) => {
              calls.push({ model, method, args });
              return method === "count" ? 0 : [];
            });
          },
        },
      );
    },
  };
  return { prisma: new Proxy({}, handler) as never, calls };
}

/** Every field name a query could read, from `select`, `by`, `where` and `orderBy`. */
function fieldNames(value: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const v of value) {
      if (typeof v === "string") out.add(v);
      else fieldNames(v, out);
    }
  } else if (value && typeof value === "object" && !(value instanceof Date)) {
    for (const [key, v] of Object.entries(value)) {
      out.add(key);
      fieldNames(v, out);
    }
  }
  return out;
}

describe("operational-only queries", () => {
  it("never select or group by anything that reveals what someone spent", async () => {
    const { prisma, calls } = recordingPrisma();
    await getAdminAnalyticsSeries(prisma, 30, now);
    await getAdminAdoptionStats(prisma, 30, now);
    expect(calls.length).toBeGreaterThan(5);

    const forbidden = ["amountCents", "preCreditCents", "creditCents", "title", "name", "merchantName", "categoryId", "note"];
    for (const call of calls) {
      const fields = fieldNames(call.args);
      for (const field of forbidden) {
        expect(fields.has(field), `${call.model}.${call.method} touches ${field}`).toBe(false);
      }
    }
  });

  it("selects only timestamps from the row-level queries", async () => {
    const { prisma, calls } = recordingPrisma();
    await getAdminAnalyticsSeries(prisma, 7, now);
    const findMany = calls.filter((c) => c.method === "findMany");
    expect(findMany.map((c) => c.model).sort()).toEqual(["auditLog", "plaidStagedTransaction", "transaction", "user"]);
    for (const call of findMany) {
      const select = (call.args as { select: Record<string, true> }).select;
      for (const key of Object.keys(select)) expect(["createdAt", "firstSeenAt", "action"]).toContain(key);
    }
  });

  it("splits the fetched span into this period and the previous one", async () => {
    const { prisma } = recordingPrisma();
    const series = await getAdminAnalyticsSeries(prisma, 7, now);
    expect(series.points).toHaveLength(7);
    expect(series.points[0]?.day).toBe("2026-09-16");
    expect(series.points.at(-1)?.day).toBe("2026-09-22");
    expect(series.totals.transactions).toBe(0);
  });
});
