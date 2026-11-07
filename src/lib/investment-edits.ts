import { Prisma, type PrismaClient } from "@prisma/client";
import {
  contributionWarningText,
  previewContribution,
  REGISTERED_ACCOUNT_TYPES,
  roomFlowsFromData,
  type RegisteredAccountType,
} from "@/lib/contribution-room";
import { loadContributionRoomData } from "@/lib/contribution-room-data";
import { dateFromYmd } from "@/lib/date-only";

/**
 * Contributions, withdrawals, portfolio values and contribution room, shared by the Investments
 * card and Settings → Accounts (`src/app/actions/investments.ts`) and the phone
 * (`/api/v1/investments`), so each saves with the same checks from both.
 */

export class InvestmentEditError extends Error {
  constructor(
    message: string,
    readonly notFound = false,
  ) {
    super(message);
    this.name = "InvestmentEditError";
  }
}

type Db = PrismaClient;

export type InvestmentFlowInput = {
  accountId: string;
  direction: "CONTRIBUTION" | "WITHDRAWAL";
  amountCents: number;
  /** YYYY-MM-DD. */
  date: string;
  note: string | null;
};

export type PortfolioValueInput = {
  accountId: string;
  totalValueCents: number;
  /** YYYY-MM-DD. */
  date: string;
  note: string | null;
};

async function assertOwnsAccount(db: Db, userId: string, accountId: string) {
  const account = await db.account.findFirst({ where: { id: accountId, userId }, select: { id: true } });
  if (!account) throw new InvestmentEditError("Selected account was not found.");
}

/**
 * What adding a contribution would do to its year's room, worded, or null when it fits, the
 * room is unknown, or the account is not a TFSA, RRSP or FHSA. Recording it is still allowed:
 * it is what happened, but going over costs 1% a month, so it should never be a surprise.
 */
export async function contributionWarning(db: Db, userId: string, input: InvestmentFlowInput): Promise<string | null> {
  if (input.direction !== "CONTRIBUTION") return null;
  const data = await loadContributionRoomData(userId, db);
  const accountType = data.accountTypes[input.accountId];
  if (!accountType) return null;
  const warning = previewContribution(accountType, dateFromYmd(input.date), input.amountCents, data.entries, roomFlowsFromData(data));
  return warning ? contributionWarningText(accountType, warning) : null;
}

export async function createInvestmentFlow(db: Db, userId: string, input: InvestmentFlowInput): Promise<string> {
  await assertOwnsAccount(db, userId, input.accountId);
  const flow = await db.investmentFlow.create({
    data: {
      userId,
      accountId: input.accountId,
      direction: input.direction,
      amountCents: input.amountCents,
      date: dateFromYmd(input.date),
      note: input.note,
    },
    select: { id: true },
  });
  return flow.id;
}

/**
 * Edits a contribution or withdrawal. A flow counted from a transfer keeps its link: the
 * amount may be corrected (a transfer that included a fee, say) without making the transfer
 * countable a second time.
 */
export async function updateInvestmentFlow(db: Db, userId: string, id: string, input: InvestmentFlowInput): Promise<void> {
  await assertOwnsAccount(db, userId, input.accountId);
  const { count } = await db.investmentFlow.updateMany({
    where: { id, userId },
    data: {
      accountId: input.accountId,
      direction: input.direction,
      amountCents: input.amountCents,
      date: dateFromYmd(input.date),
      note: input.note,
    },
  });
  if (count === 0) throw new InvestmentEditError("That contribution or withdrawal was not found.", true);
}

/** Deleting a flow counted from a transfer makes that transfer countable again. */
export async function deleteInvestmentFlow(db: Db, userId: string, id: string): Promise<void> {
  const { count } = await db.investmentFlow.deleteMany({ where: { id, userId } });
  if (count === 0) throw new InvestmentEditError("That contribution or withdrawal was not found.", true);
}

export async function createPortfolioValue(db: Db, userId: string, input: PortfolioValueInput): Promise<string> {
  await assertOwnsAccount(db, userId, input.accountId);
  const snapshot = await db.portfolioSnapshot.create({
    data: {
      userId,
      accountId: input.accountId,
      totalValueCents: input.totalValueCents,
      date: dateFromYmd(input.date),
      note: input.note,
    },
    select: { id: true },
  });
  return snapshot.id;
}

export async function updatePortfolioValue(db: Db, userId: string, id: string, input: PortfolioValueInput): Promise<void> {
  await assertOwnsAccount(db, userId, input.accountId);
  const { count } = await db.portfolioSnapshot.updateMany({
    where: { id, userId },
    data: {
      accountId: input.accountId,
      totalValueCents: input.totalValueCents,
      date: dateFromYmd(input.date),
      note: input.note,
    },
  });
  if (count === 0) throw new InvestmentEditError("That portfolio value was not found.", true);
}

export async function deletePortfolioValue(db: Db, userId: string, id: string): Promise<void> {
  const { count } = await db.portfolioSnapshot.deleteMany({ where: { id, userId } });
  if (count === 0) throw new InvestmentEditError("That portfolio value was not found.", true);
}

/**
 * Records a contribution from a transfer that arrived in a TFSA, RRSP or FHSA, so a deposit
 * synced from the bank does not have to be typed in again for contribution room. Transfers
 * follow the expense sign, so money arriving is a negative amount.
 */
export async function countTransferTowardRoom(db: Db, userId: string, transactionId: string): Promise<string> {
  const transfer = await db.transaction.findFirst({
    where: {
      id: transactionId,
      userId,
      type: "TRANSFER",
      amountCents: { lt: 0 },
      account: { type: { in: [...REGISTERED_ACCOUNT_TYPES] } },
    },
    select: { id: true, accountId: true, amountCents: true, date: true, title: true },
  });
  if (!transfer?.accountId) throw new InvestmentEditError("Only a transfer into a TFSA, RRSP or FHSA can count toward room.");

  try {
    const flow = await db.investmentFlow.create({
      data: {
        userId,
        accountId: transfer.accountId,
        direction: "CONTRIBUTION",
        amountCents: -transfer.amountCents,
        date: transfer.date,
        note: transfer.title?.slice(0, 250) || null,
        transactionId: transfer.id,
      },
      select: { id: true },
    });
    return flow.id;
  } catch (error) {
    // Already counted (two clicks, or two tabs): the unique link refuses the second.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new InvestmentEditError("That transfer already counts toward room.");
    }
    throw error;
  }
}

/** Saves one year's room for one account type, replacing any figure already entered. */
export async function setContributionRoom(
  db: Db,
  userId: string,
  input: { accountType: RegisteredAccountType; year: number; roomCents: number },
): Promise<void> {
  await db.contributionRoom.upsert({
    where: { userId_accountType_year: { userId, accountType: input.accountType, year: input.year } },
    create: { userId, accountType: input.accountType, year: input.year, roomCents: input.roomCents },
    update: { roomCents: input.roomCents },
  });
}

export async function deleteContributionRoom(db: Db, userId: string, id: string): Promise<void> {
  const { count } = await db.contributionRoom.deleteMany({ where: { id, userId } });
  if (count === 0) throw new InvestmentEditError("That room figure was not found.", true);
}
