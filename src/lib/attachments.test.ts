import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { copyMigratedDatabase } from "@/test-support/migrated-db";
import {
  addAttachment,
  cleanAttachmentName,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS_PER_TRANSACTION,
  readAttachment,
  sniffAttachmentType,
} from "./attachments";
import { deleteTransactionWithUndo, undoDeletedTransaction, UNDO_WINDOW_MS } from "./transaction-undo";

const bytes = (...parts: Array<number[] | string>) =>
  new Uint8Array(parts.flatMap((p) => (typeof p === "string" ? [...p].map((c) => c.charCodeAt(0)) : p)));
const PNG = bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], "rest");
const PDF = bytes("%PDF-1.7 ...");

describe("what counts as a receipt", () => {
  it("recognises images and PDFs from their bytes", () => {
    expect(sniffAttachmentType(bytes([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(sniffAttachmentType(PNG)).toBe("image/png");
    expect(sniffAttachmentType(bytes("GIF89a"))).toBe("image/gif");
    expect(sniffAttachmentType(bytes("RIFF", [0, 0, 0, 0], "WEBPVP8"))).toBe("image/webp");
    expect(sniffAttachmentType(PDF)).toBe("application/pdf");
    expect(sniffAttachmentType(bytes([0, 0, 0, 0x18], "ftypheic"))).toBe("image/heic");
  });

  it("refuses anything else, whatever it is called", () => {
    expect(sniffAttachmentType(bytes('<svg xmlns="http://www.w3.org/2000/svg">'))).toBeNull();
    expect(sniffAttachmentType(bytes("<html>"))).toBeNull();
    expect(sniffAttachmentType(bytes("MZ"))).toBeNull();
  });

  it("keeps a file name safe for a header", () => {
    expect(cleanAttachmentName('C:\\Users\\me\\re"ceipt.jpg', "image/jpeg")).toBe("receipt.jpg");
    expect(cleanAttachmentName("", "application/pdf")).toBe("receipt.pdf");
  });
});

const dir = mkdtempSync(join(tmpdir(), "attach-"));
const url = `file:${join(dir, "a.db")}`;
let db: PrismaClient;

beforeAll(() => {
  copyMigratedDatabase(url);
  db = new PrismaClient({ datasourceUrl: url });
});

afterAll(async () => {
  await db?.$disconnect();
  rmSync(dir, { recursive: true, force: true });
});

let seq = 0;
let userId: string;
let txId: string;

beforeEach(async () => {
  seq += 1;
  userId = (await db.user.create({ data: { email: `a${seq}@example.test`, displayName: "T" } })).id;
  const cat = await db.category.create({ data: { userId, name: "Food", kind: "EXPENSE" } });
  txId = (
    await db.transaction.create({
      data: { userId, categoryId: cat.id, type: "EXPENSE", amountCents: 100, date: new Date("2026-10-01T00:00:00Z") },
    })
  ).id;
});

describe("keeping receipts", () => {
  it("stores a receipt on the user's own transaction and reads it back", async () => {
    const added = await addAttachment(db, { userId, transactionId: txId, fileName: "r.png", bytes: PNG });
    if (!added.ok) throw new Error(added.reason);
    const read = await readAttachment(db, userId, added.id);
    expect(read).toMatchObject({ fileName: "r.png", contentType: "image/png" });
    expect(Buffer.from(read!.data).equals(Buffer.from(PNG))).toBe(true);

    const other = (await db.user.create({ data: { email: `o${seq}@example.test`, displayName: "O" } })).id;
    expect(await readAttachment(db, other, added.id)).toBeNull();
    expect(await addAttachment(db, { userId: other, transactionId: txId, fileName: "x.png", bytes: PNG })).toEqual({
      ok: false,
      reason: "not-found",
    });
  });

  it("refuses empty, oversized, unknown files and more than the limit", async () => {
    const add = (b: Uint8Array) => addAttachment(db, { userId, transactionId: txId, fileName: "f", bytes: b });
    expect(await add(new Uint8Array())).toEqual({ ok: false, reason: "empty" });
    expect(await add(new Uint8Array(MAX_ATTACHMENT_BYTES + 1))).toEqual({ ok: false, reason: "too-large" });
    expect(await add(bytes("<svg/>"))).toEqual({ ok: false, reason: "type" });
    for (let i = 0; i < MAX_ATTACHMENTS_PER_TRANSACTION; i++) expect((await add(PDF)).ok).toBe(true);
    expect(await add(PDF)).toEqual({ ok: false, reason: "too-many" });
  });

  it("survives delete and Undo, and goes with the undo record once that expires", async () => {
    const added = await addAttachment(db, { userId, transactionId: txId, fileName: "r.pdf", bytes: PDF });
    if (!added.ok) throw new Error(added.reason);
    const undoId = await deleteTransactionWithUndo(db, userId, txId, "EXPENSE");
    // Not readable while its entry is deleted.
    expect(await readAttachment(db, userId, added.id)).toBeNull();
    expect((await undoDeletedTransaction(db, userId, undoId!)).ok).toBe(true);
    expect((await db.transactionAttachment.findUniqueOrThrow({ where: { id: added.id } })).transactionId).toBe(txId);

    const old = new Date(Date.now() - UNDO_WINDOW_MS - 60_000);
    await deleteTransactionWithUndo(db, userId, txId, "EXPENSE", old);
    expect(await db.transactionAttachment.count({ where: { id: added.id } })).toBe(1);
    // The next delete prunes expired undo records, and the receipts only they could bring back.
    const cat = await db.category.findFirstOrThrow({ where: { userId } });
    const another = await db.transaction.create({
      data: { userId, categoryId: cat.id, type: "EXPENSE", amountCents: 1, date: new Date("2026-10-02T00:00:00Z") },
    });
    await deleteTransactionWithUndo(db, userId, another.id, "EXPENSE");
    expect(await db.transactionAttachment.count({ where: { id: added.id } })).toBe(0);
  });
});
