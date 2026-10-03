import { prisma } from "@/lib/prisma";
import { ymdFromDateUtc } from "@/lib/date-only";
import {
  isRegisteredAccountType,
  REGISTERED_ACCOUNT_TYPES,
  type ContributionRoomData,
  type RegisteredAccountType,
} from "@/lib/contribution-room";

/**
 * Everything the room math needs for one user. Flows are classified by the account's
 * current type, so retyping an account moves its history with it, and archived accounts
 * still count: their contributions used room all the same.
 */
export async function loadContributionRoomData(userId: string): Promise<ContributionRoomData> {
  const registered = [...REGISTERED_ACCOUNT_TYPES];
  const [entries, flows, accounts] = await Promise.all([
    prisma.contributionRoom.findMany({
      where: { userId, accountType: { in: registered } },
      orderBy: [{ accountType: "asc" }, { year: "desc" }],
    }),
    prisma.investmentFlow.findMany({
      where: { userId, account: { type: { in: registered } } },
      select: { date: true, direction: true, amountCents: true, account: { select: { type: true } } },
    }),
    prisma.account.findMany({
      where: { userId, type: { in: registered } },
      select: { id: true, type: true },
    }),
  ]);

  const accountTypes: Record<string, RegisteredAccountType> = {};
  for (const account of accounts) {
    if (isRegisteredAccountType(account.type)) accountTypes[account.id] = account.type;
  }

  return {
    entries: entries.flatMap((row) =>
      isRegisteredAccountType(row.accountType)
        ? [{ id: row.id, accountType: row.accountType, year: row.year, roomCents: row.roomCents }]
        : [],
    ),
    flows: flows.flatMap((row) =>
      isRegisteredAccountType(row.account.type)
        ? [{ accountType: row.account.type, date: ymdFromDateUtc(row.date), direction: row.direction, amountCents: row.amountCents }]
        : [],
    ),
    accountTypes,
  };
}
