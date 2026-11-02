import { Prisma, type PrismaClient } from "@prisma/client";

/**
 * `Idempotency-Key` on `POST /api/v1/transactions`. The phone sends one per add, so when the
 * connection drops after the server saved the entry but before the answer arrived, sending the
 * same add again answers with the entry already made instead of adding it a second time.
 *
 * A key is claimed before the entry is written (the row is the lock two racing retries contend
 * for), pointed at the entry inside the same database transaction that writes it
 * (`createTransactionFromApi`), and let go again when the add is refused, so a corrected retry
 * can use it. It is remembered for a day; older keys are pruned as new ones arrive.
 */

/** Long enough that keys cannot collide by accident, short enough to index; URL-safe. */
export const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_-]{16,100}$/;
/** A retry comes within seconds; a day also covers a phone left offline overnight. */
export const IDEMPOTENCY_KEY_TTL_MS = 24 * 60 * 60 * 1000;
/**
 * A claim this old with nothing saved belongs to a request that died part-way (the server was
 * restarted mid-add), so a retry may take it over. Far longer than an add takes, and than the
 * phone waits for an answer.
 */
export const IDEMPOTENCY_STALE_CLAIM_MS = 2 * 60 * 1000;

export type IdempotencyClaim =
  /** This request owns the key: add the entry and pass `keyId` to `createTransactionFromApi`. */
  | { status: "claimed"; keyId: string }
  /** An earlier request with this key already added this entry (it may have been deleted since). */
  | { status: "done"; transactionId: string }
  /** An earlier request with this key is still being handled. */
  | { status: "busy" };

/** The header's value, null when there is none, or "invalid". */
export function readIdempotencyKey(headers: Headers): string | null | "invalid" {
  const raw = headers.get("idempotency-key");
  if (raw === null) return null;
  return IDEMPOTENCY_KEY_PATTERN.test(raw) ? raw : "invalid";
}

export async function claimIdempotencyKey(
  db: PrismaClient,
  userId: string,
  key: string,
  now: Date = new Date(),
): Promise<IdempotencyClaim> {
  await db.apiIdempotencyKey.deleteMany({ where: { createdAt: { lt: new Date(now.getTime() - IDEMPOTENCY_KEY_TTL_MS) } } });
  // Twice at most: a claim found taken can be let go (its add refused) before it is read back.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const row = await db.apiIdempotencyKey.create({ data: { userId, key, createdAt: now }, select: { id: true } });
      return { status: "claimed", keyId: row.id };
    } catch (err) {
      if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002")) throw err;
    }
    const existing = await db.apiIdempotencyKey.findUnique({ where: { userId_key: { userId, key } } });
    if (!existing) continue;
    if (existing.transactionId) return { status: "done", transactionId: existing.transactionId };
    if (existing.createdAt.getTime() > now.getTime() - IDEMPOTENCY_STALE_CLAIM_MS) return { status: "busy" };
    // Matching on the old `createdAt` means only one of several retries takes it over.
    const taken = await db.apiIdempotencyKey.updateMany({
      where: { id: existing.id, transactionId: null, createdAt: existing.createdAt },
      data: { createdAt: now },
    });
    return taken.count === 1 ? { status: "claimed", keyId: existing.id } : { status: "busy" };
  }
  return { status: "busy" };
}

/** Lets a claimed key go when its add was refused or failed, so the same key can be sent again. */
export async function releaseIdempotencyKey(db: PrismaClient, keyId: string): Promise<void> {
  await db.apiIdempotencyKey.deleteMany({ where: { id: keyId, transactionId: null } });
}
