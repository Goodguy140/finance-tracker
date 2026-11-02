import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PrismaClient } from "@prisma/client";
import { NextResponse } from "next/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { copyMigratedDatabase } from "@/test-support/migrated-db";

// The phone holds `app`; a personal access token, even one that reads transactions, does not.
const caller = vi.hoisted(() => ({ userId: "", scopes: new Set<string>() }));
vi.mock("@/lib/api-v1/route-auth", () => ({
  NO_STORE: {},
  authorizeApiRequest: vi.fn(async (_request: Request, scope: string) =>
    caller.scopes.has(scope)
      ? { ok: true, auth: { user: { id: caller.userId }, token: { kind: "device", id: "dev" } } }
      : { ok: false, response: NextResponse.json({ error: "missing scope" }, { status: 403 }) },
  ),
}));

const dir = mkdtempSync(join(tmpdir(), "api-v1-receipts-"));
const url = `file:${join(dir, "api.db")}`;
let db: PrismaClient;
let upload: typeof import("../../transactions/[id]/attachments/route").POST;
let serve: typeof import("./route").GET;
let remove: typeof import("./route").DELETE;
let detail: typeof import("@/lib/api-v1/transactions").getTransactionForApi;

beforeAll(async () => {
  copyMigratedDatabase(url);
  process.env.DATABASE_URL = url;
  ({ prisma: db } = await import("@/lib/prisma"));
  ({ POST: upload } = await import("../../transactions/[id]/attachments/route"));
  ({ GET: serve, DELETE: remove } = await import("./route"));
  ({ getTransactionForApi: detail } = await import("@/lib/api-v1/transactions"));
});

afterAll(async () => {
  await db?.$disconnect();
  rmSync(dir, { recursive: true, force: true });
});

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70, 0]);
let seq = 0;
let transactionId: string;

beforeEach(async () => {
  seq += 1;
  const user = await db.user.create({ data: { email: `receipt${seq}@example.test`, displayName: "R" } });
  const category = await db.category.create({ data: { userId: user.id, name: "Food", kind: "EXPENSE" } });
  transactionId = (
    await db.transaction.create({ data: { userId: user.id, type: "EXPENSE", amountCents: 500, categoryId: category.id, date: new Date() } })
  ).id;
  caller.userId = user.id;
  caller.scopes = new Set(["app", "transactions:read"]);
});

const params = (id: string) => ({ params: Promise.resolve({ id }) });
function send(id: string, bytes: Uint8Array<ArrayBuffer>, name = "IMG_0001.jpg") {
  const form = new FormData();
  form.append("file", new File([bytes], name, { type: "image/jpeg" }));
  return upload(new Request(`http://localhost/api/v1/transactions/${id}/attachments`, { method: "POST", body: form }), params(id));
}
const get = (id: string) => serve(new Request(`http://localhost/api/v1/attachments/${id}`), params(id));

describe("receipts from the phone", () => {
  it("keeps a photo with an entry, lists it on the entry, serves it, and takes it off again", async () => {
    const res = await send(transactionId, JPEG);
    expect(res.status).toBe(201);
    const { attachment } = await res.json();

    expect((await detail(db, caller.userId, transactionId))?.attachments).toEqual([
      { id: attachment.id, fileName: "IMG_0001.jpg", contentType: "image/jpeg", sizeBytes: JPEG.length },
    ]);
    const file = await get(attachment.id);
    expect(file.status).toBe(200);
    expect(file.headers.get("content-type")).toBe("image/jpeg");
    expect(file.headers.get("content-security-policy")).toContain("sandbox");
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(JPEG);

    const gone = await remove(new Request("http://localhost", { method: "DELETE" }), params(attachment.id));
    expect(gone.status).toBe(204);
    expect((await get(attachment.id)).status).toBe(404);
    expect(await db.transactionAttachment.count({ where: { transactionId } })).toBe(0);
  });

  it("refuses what is not a photo or PDF, entries that are not the user's, and bodies that are not multipart", async () => {
    expect((await send(transactionId, new TextEncoder().encode("<svg onload=alert(1)>"), "x.svg")).status).toBe(415);
    expect((await send("someone-elses", JPEG)).status).toBe(404);
    const plain = await upload(
      new Request("http://localhost", { method: "POST", body: "hello", headers: { "content-type": "text/plain" } }),
      params(transactionId),
    );
    expect(plain.status).toBe(400);
    const huge = await upload(
      new Request("http://localhost", { method: "POST", body: "x", headers: { "content-length": String(20 * 1024 * 1024) } }),
      params(transactionId),
    );
    expect(huge.status).toBe(413);
    expect(await db.transactionAttachment.count({ where: { transactionId } })).toBe(0);
  });

  it("keeps receipts from personal access tokens, even ones that read transactions", async () => {
    const { attachment } = await (await send(transactionId, JPEG)).json();
    caller.scopes = new Set(["transactions:read", "transactions:write"]);
    expect((await get(attachment.id)).status).toBe(403);
    expect((await send(transactionId, JPEG)).status).toBe(403);
    expect((await remove(new Request("http://localhost", { method: "DELETE" }), params(attachment.id))).status).toBe(403);
    expect(await db.transactionAttachment.count({ where: { transactionId } })).toBe(1);
  });
});
