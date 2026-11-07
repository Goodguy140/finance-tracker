import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { copyMigratedDatabase } from "@/test-support/migrated-db";

/** The Investments card for the phone, against a real SQLite database built from the migrations. */

const dir = mkdtempSync(join(tmpdir(), "api-investments-"));
const url = `file:${join(dir, "investments.db")}`;
let db: PrismaClient;
let api: typeof import("./investments");

beforeAll(async () => {
  copyMigratedDatabase(url);
  process.env.DATABASE_URL = url;
  ({ prisma: db } = await import("@/lib/prisma"));
  api = await import("./investments");
});

afterAll(async () => {
  await db?.$disconnect();
  rmSync(dir, { recursive: true, force: true });
});

// Days in UTC, as the test user's time zone is.
const dayAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
const today = dayAgo(0);
const thisYear = Number(today.slice(0, 4));

let seq = 0;
let user: { id: string; timezone: string; countryCode: string };
let tfsa: string;

beforeEach(async () => {
  seq += 1;
  user = await db.user.create({
    data: { email: `invest${seq}@example.test`, displayName: "Test", timezone: "UTC", countryCode: "CA" },
    select: { id: true, timezone: true, countryCode: true },
  });
  tfsa = (await db.account.create({ data: { userId: user.id, name: "TFSA", type: "TFSA" } })).id;
});

const load = () => api.loadAppInvestments(db, user);

describe("contribution room", () => {
  it("asks before a contribution goes over the year's room, and records it once told to", async () => {
    expect(await api.setRoomFromApi(db, user.id, { accountType: "TFSA", year: thisYear, roomCents: 700_000 })).toEqual({ ok: true });
    const add = (amountCents: number, overRoom?: boolean) =>
      api.saveInvestmentFlowFromApi(db, user.id, null, { accountId: tfsa, direction: "contribution", amountCents, date: today, overRoom });

    expect(await add(500_000)).toMatchObject({ ok: true });
    const over = await add(300_000);
    expect(over).toMatchObject({ ok: false, status: 409, overRoom: true });
    expect(over.ok ? "" : over.error).toMatch(/^Only \$2,000\.00 of \d{4} TFSA room left\. \$1,000\.00 over your \d{4} TFSA room/);
    // Nothing was saved by the refusal.
    expect((await load()).room[0]).toMatchObject({ accountType: "TFSA", remainingCents: 200_000, overText: null });

    expect(await add(300_000, true)).toMatchObject({ ok: true });
    const [room] = (await load()).room;
    expect(room).toMatchObject({ year: thisYear, source: "entered", startingRoomCents: 700_000, contributedCents: 800_000, remainingCents: -100_000, overCents: 100_000 });
    expect(room.overText).toContain("CRA charges 1% a month");
    expect(room.entries).toEqual([{ id: expect.any(String), year: thisYear, roomCents: 700_000 }]);

    // A withdrawal never asks.
    expect(await api.saveInvestmentFlowFromApi(db, user.id, null, { accountId: tfsa, direction: "withdrawal", amountCents: 900_000, date: today })).toMatchObject({ ok: true });
  });

  it("replaces a year's figure, removes it, and refuses a year before room existed", async () => {
    await api.setRoomFromApi(db, user.id, { accountType: "TFSA", year: thisYear, roomCents: 100_000 });
    await api.setRoomFromApi(db, user.id, { accountType: "TFSA", year: thisYear, roomCents: 250_000 });
    const [room] = (await load()).room;
    expect(room.entries).toEqual([{ id: expect.any(String), year: thisYear, roomCents: 250_000 }]);

    expect(await api.deleteRoomFromApi(db, user.id, room.entries[0].id)).toEqual({ ok: true });
    expect((await load()).room[0]).toMatchObject({ source: "unknown", remainingCents: null, entries: [] });
    expect(await api.deleteRoomFromApi(db, user.id, room.entries[0].id)).toMatchObject({ ok: false, status: 404 });
    expect(await api.setRoomFromApi(db, user.id, { accountType: "TFSA", year: 2008, roomCents: 1 })).toMatchObject({ ok: false, status: 400 });
    expect(await api.setRoomFromApi(db, user.id, { accountType: "LIRA", year: thisYear, roomCents: 1 })).toMatchObject({ ok: false, status: 400 });
  });
});

describe("activity", () => {
  it("counts a deposit into a TFSA toward room once, and offers it again when that contribution goes", async () => {
    const chequing = (await db.account.create({ data: { userId: user.id, name: "Chequing", type: "CHEQUING" } })).id;
    const transfers = (await db.category.create({ data: { userId: user.id, name: "Transfers", kind: "TRANSFER" } })).id;
    const transfer = await db.transaction.create({
      data: { userId: user.id, categoryId: transfers, type: "TRANSFER", amountCents: -50_000, accountId: tfsa, transferAccountId: chequing, date: new Date(`${today}T00:00:00Z`), title: "To TFSA" },
    });

    expect((await load()).activity).toEqual([
      expect.objectContaining({ kind: "transfer", id: transfer.id, accountName: "TFSA", amountCents: 50_000, date: today, note: "To TFSA" }),
    ]);

    const counted = await api.countTransferFromApi(db, user.id, transfer.id);
    expect(counted).toMatchObject({ ok: true });
    expect((await load()).activity).toEqual([
      expect.objectContaining({ kind: "contribution", accountId: tfsa, amountCents: 50_000, fromTransfer: true }),
    ]);
    expect(await api.countTransferFromApi(db, user.id, transfer.id)).toEqual({ ok: false, status: 400, error: "That transfer already counts toward room." });

    expect(await api.deleteInvestmentEntryFromApi(db, user.id, "flow", counted.ok ? counted.id! : "")).toEqual({ ok: true });
    expect((await load()).activity.map((a) => a.kind)).toEqual(["transfer"]);
  });

  it("records, changes and deletes portfolio values, and gives the account's value and return", async () => {
    const first = await api.saveInvestmentValueFromApi(db, user.id, null, { accountId: tfsa, totalValueCents: 100_000, date: dayAgo(10) });
    const second = await api.saveInvestmentValueFromApi(db, user.id, null, { accountId: tfsa, totalValueCents: 99_000, date: today, note: "Statement" });
    expect(second).toMatchObject({ ok: true });
    expect(await api.saveInvestmentValueFromApi(db, user.id, second.ok ? second.id! : "", { accountId: tfsa, totalValueCents: 101_000, date: today, note: "Statement" })).toMatchObject({ ok: true });

    const loaded = await load();
    expect(loaded.activity.map((a) => [a.kind, a.amountCents, a.date, a.note])).toEqual([
      ["value", 101_000, today, "Statement"],
      ["value", 100_000, dayAgo(10), null],
    ]);
    expect(loaded.returns).toEqual([
      { accountId: tfsa, name: "TFSA", currency: "CAD", valueCents: 101_000, thisYear: expect.anything(), twelveMonths: { rate: expect.any(Number), annualized: false } },
    ]);
    expect(loaded.returns[0].twelveMonths!.rate).toBeCloseTo(0.01, 4);

    expect(await api.deleteInvestmentEntryFromApi(db, user.id, "value", first.ok ? first.id! : "")).toEqual({ ok: true });
    expect((await load()).returns).toEqual([]);
  });

  it("refuses another person's account or entry, and what the card does not take", async () => {
    const other = await db.user.create({ data: { email: `investother${seq}@example.test`, displayName: "Other" } });
    const theirs = (await db.account.create({ data: { userId: other.id, name: "Theirs", type: "TFSA" } })).id;
    const flow = { accountId: theirs, direction: "contribution", amountCents: 1_000, date: today };
    expect(await api.saveInvestmentFlowFromApi(db, user.id, null, flow)).toEqual({ ok: false, status: 400, error: "Selected account was not found." });

    const mine = await api.saveInvestmentFlowFromApi(db, other.id, null, flow);
    expect(await api.saveInvestmentFlowFromApi(db, user.id, mine.ok ? mine.id! : "", { ...flow, accountId: tfsa })).toMatchObject({ ok: false, status: 404 });
    expect(await api.deleteInvestmentEntryFromApi(db, user.id, "flow", mine.ok ? mine.id! : "")).toMatchObject({ ok: false, status: 404 });

    expect(await api.saveInvestmentFlowFromApi(db, user.id, null, { ...flow, accountId: tfsa, direction: "dividend" })).toMatchObject({ ok: false, status: 400 });
    expect(await api.saveInvestmentFlowFromApi(db, user.id, null, { ...flow, accountId: tfsa, amountCents: 0 })).toMatchObject({ ok: false, status: 400 });
    expect(await api.saveInvestmentFlowFromApi(db, user.id, null, { ...flow, accountId: tfsa, date: `${thisYear}-02-30` })).toMatchObject({ ok: false, status: 400 });
    expect(await api.saveInvestmentValueFromApi(db, user.id, null, { accountId: tfsa, totalValueCents: -1, date: today })).toMatchObject({ ok: false, status: 400 });
    expect(await api.countTransferFromApi(db, user.id, "nothing")).toMatchObject({ ok: false, status: 400 });
    expect((await load()).activity).toEqual([]);
  });
});
