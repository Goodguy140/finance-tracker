import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { copyMigratedDatabase } from "@/test-support/migrated-db";
import {
  claimIdempotencyKey,
  IDEMPOTENCY_KEY_TTL_MS,
  IDEMPOTENCY_STALE_CLAIM_MS,
  readIdempotencyKey,
  releaseIdempotencyKey,
} from "./idempotency";

const dir = mkdtempSync(join(tmpdir(), "idempotency-"));
const url = `file:${join(dir, "keys.db")}`;
let db: PrismaClient;

beforeAll(() => {
  copyMigratedDatabase(url);
  db = new PrismaClient({ datasources: { db: { url } } });
});

afterAll(async () => {
  await db?.$disconnect();
  rmSync(dir, { recursive: true, force: true });
});

let seq = 0;
let userId: string;
const KEY = "0f6c2b8e-4d1a-4c77-9b0e-2f1d3a5c7e90";
const at = (ms: number) => new Date(Date.UTC(2026, 10, 2, 12) + ms);

beforeEach(async () => {
  seq += 1;
  userId = (await db.user.create({ data: { email: `key${seq}@example.test`, displayName: "Key" } })).id;
});

async function finish(keyId: string) {
  const category = await db.category.create({ data: { userId, name: `C${seq}`, kind: "EXPENSE" } });
  const tx = await db.transaction.create({
    data: { userId, type: "EXPENSE", amountCents: 100, categoryId: category.id, date: at(0) },
  });
  await db.apiIdempotencyKey.update({ where: { id: keyId }, data: { transactionId: tx.id } });
  return tx.id;
}

describe("claimIdempotencyKey", () => {
  it("claims a new key, reports it busy while the add runs, then done with the entry", async () => {
    const claim = await claimIdempotencyKey(db, userId, KEY, at(0));
    expect(claim.status).toBe("claimed");
    if (claim.status !== "claimed") return;
    expect(await claimIdempotencyKey(db, userId, KEY, at(1_000))).toEqual({ status: "busy" });

    const transactionId = await finish(claim.keyId);
    expect(await claimIdempotencyKey(db, userId, KEY, at(2_000))).toEqual({ status: "done", transactionId });
  });

  it("keeps each user's keys apart", async () => {
    const mine = await claimIdempotencyKey(db, userId, KEY, at(0));
    const other = (await db.user.create({ data: { email: `other${seq}@example.test`, displayName: "Other" } })).id;
    const theirs = await claimIdempotencyKey(db, other, KEY, at(0));
    expect(mine.status).toBe("claimed");
    expect(theirs.status).toBe("claimed");
  });

  it("lets a released key be claimed again, but never releases one that added an entry", async () => {
    const first = await claimIdempotencyKey(db, userId, KEY, at(0));
    if (first.status !== "claimed") throw new Error("expected a claim");
    await releaseIdempotencyKey(db, first.keyId);
    const second = await claimIdempotencyKey(db, userId, KEY, at(1_000));
    expect(second.status).toBe("claimed");
    if (second.status !== "claimed") return;

    const transactionId = await finish(second.keyId);
    await releaseIdempotencyKey(db, second.keyId);
    expect(await claimIdempotencyKey(db, userId, KEY, at(2_000))).toEqual({ status: "done", transactionId });
  });

  it("hands a claim abandoned part-way to exactly one later retry", async () => {
    const abandoned = await claimIdempotencyKey(db, userId, KEY, at(0));
    expect(abandoned.status).toBe("claimed");
    const later = at(IDEMPOTENCY_STALE_CLAIM_MS + 1);
    const retries = await Promise.all([claimIdempotencyKey(db, userId, KEY, later), claimIdempotencyKey(db, userId, KEY, later)]);
    expect(retries.map((r) => r.status).sort()).toEqual(["busy", "claimed"]);
  });

  it("forgets keys after a day", async () => {
    const old = await claimIdempotencyKey(db, userId, KEY, at(0));
    if (old.status !== "claimed") throw new Error("expected a claim");
    await finish(old.keyId);
    const nextDay = await claimIdempotencyKey(db, userId, KEY, at(IDEMPOTENCY_KEY_TTL_MS + 1));
    expect(nextDay.status).toBe("claimed");
    expect(await db.apiIdempotencyKey.count({ where: { userId } })).toBe(1);
  });
});

describe("readIdempotencyKey", () => {
  it("takes a UUID or similar, and refuses anything short or with other characters", () => {
    expect(readIdempotencyKey(new Headers())).toBeNull();
    expect(readIdempotencyKey(new Headers({ "Idempotency-Key": KEY }))).toBe(KEY);
    expect(readIdempotencyKey(new Headers({ "Idempotency-Key": "abc" }))).toBe("invalid");
    expect(readIdempotencyKey(new Headers({ "Idempotency-Key": "abcd efgh ijkl mnop" }))).toBe("invalid");
    expect(readIdempotencyKey(new Headers({ "Idempotency-Key": "x".repeat(101) }))).toBe("invalid");
    expect(readIdempotencyKey(new Headers({ "Idempotency-Key": "a/b".repeat(10) }))).toBe("invalid");
  });
});
