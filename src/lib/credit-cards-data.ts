import type { PrismaClient } from "@prisma/client";
import type { CardTerms } from "@/lib/credit-cards";

/**
 * Home-currency cards with a due day, each with its latest balance reading: what bill reminders
 * and the dashboard's Upcoming bills and Calendar cards list card payments from.
 */
export async function loadCardTerms(
  client: PrismaClient,
  userId: string,
  currency: string,
): Promise<Array<CardTerms & { paymentRemindedFor: Date | null }>> {
  const cards = await client.account.findMany({
    where: { userId, archived: false, currency, type: "CREDIT_CARD", paymentDueDay: { not: null } },
    select: { id: true, name: true, paymentDueDay: true, minimumPaymentCents: true, paymentRemindedFor: true },
  });
  if (cards.length === 0) return [];
  const readings = await client.accountBalanceSnapshot.findMany({
    where: { accountId: { in: cards.map((c) => c.id) } },
    orderBy: { date: "desc" },
    select: { accountId: true, date: true, balanceCents: true },
  });
  const latest = new Map<string, { cents: number; date: Date }>();
  for (const r of readings) if (!latest.has(r.accountId)) latest.set(r.accountId, { cents: r.balanceCents, date: r.date });
  return cards.map((c) => ({ ...c, owed: latest.get(c.id) ?? null }));
}
