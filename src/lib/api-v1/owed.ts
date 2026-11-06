import type { Prisma, PrismaClient } from "@prisma/client";
import { z } from "zod";
import { ymdFromDateUtc } from "@/lib/date-only";
import { OWED_TO_YOU_ORDER, owedToYouWhere } from "@/lib/owed-to-you";

/**
 * `GET /api/v1/owed`: the Expense Log's "Owed to you" for the phone. Every share still outstanding
 * and those paid back lately, each with the expense it is owed on (which opens on the phone).
 * Shares are added and changed with the expense (`PATCH /api/v1/transactions/:id`).
 */

const include = {
  transaction: {
    select: { id: true, title: true, date: true, category: { select: { name: true } }, account: { select: { currency: true } } },
  },
} satisfies Prisma.OwedShareInclude;

type Row = Prisma.OwedShareGetPayload<{ include: typeof include }>;

export function serializeOwedToYou(rows: Row[], homeCurrency: string) {
  const items = rows.map((row) => ({
    id: row.id,
    name: row.name,
    amountCents: row.amountCents,
    currency: row.transaction.account?.currency ?? homeCurrency,
    transactionId: row.transaction.id,
    /** The expense's title, or its category when it has none. */
    expenseLabel: row.transaction.title?.trim() || row.transaction.category.name,
    expenseDate: ymdFromDateUtc(row.transaction.date),
    /** When it was marked paid back; null while outstanding. */
    paidAt: row.paidAt?.toISOString() ?? null,
  }));
  const outstanding = items.filter((item) => item.paidAt === null && item.currency === homeCurrency);
  return {
    currency: homeCurrency,
    /** Still to come back, in the home currency (a share on another currency's account is left out). */
    outstandingCents: outstanding.reduce((sum, item) => sum + item.amountCents, 0),
    items,
  };
}

export type AppOwedToYou = ReturnType<typeof serializeOwedToYou>;

export async function loadAppOwedToYou(db: PrismaClient, userId: string, homeCurrency: string, now = new Date()): Promise<AppOwedToYou> {
  const rows = await db.owedShare.findMany({ where: owedToYouWhere(userId, now), include, orderBy: OWED_TO_YOU_ORDER });
  return serializeOwedToYou(rows, homeCurrency);
}

const paidSchema = z.object({ paid: z.boolean() }).strict();

/** `{ "paid": true | false }`. */
export function parsePaidBody(body: unknown): { ok: true; paid: boolean } | { ok: false; error: string } {
  const parsed = paidSchema.safeParse(body);
  return parsed.success ? { ok: true, paid: parsed.data.paid } : { ok: false, error: "Send { \"paid\": true } or { \"paid\": false }." };
}
