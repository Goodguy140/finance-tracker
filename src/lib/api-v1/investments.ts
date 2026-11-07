import { TransactionType, type PrismaClient } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";
import {
  computeRoomYear,
  overContributionMessage,
  REGISTERED_ACCOUNT_TYPES,
  roomFlowsFromData,
  roomYearFor,
  type RegisteredAccountType,
} from "@/lib/contribution-room";
import { loadContributionRoomData } from "@/lib/contribution-room-data";
import { dateFromYmd, ymdFromDateUtc } from "@/lib/date-only";
import { homeCurrencyOf } from "@/lib/home-currency";
import {
  contributionWarning,
  countTransferTowardRoom,
  createInvestmentFlow,
  createPortfolioValue,
  deleteContributionRoom,
  deleteInvestmentFlow,
  deletePortfolioValue,
  InvestmentEditError,
  setContributionRoom,
  updateInvestmentFlow,
  updatePortfolioValue,
  type InvestmentFlowInput,
  type PortfolioValueInput,
} from "@/lib/investment-edits";
import { displayRate, type ReturnWindow } from "@/lib/investment-returns";
import { loadInvestmentReturns } from "@/lib/investment-returns-data";
import { apiError, NO_STORE } from "@/lib/api-v1/route-auth";
import { MAX_AMOUNT_CENTS } from "@/lib/money";
import { currentYmdInTimeZone } from "@/lib/period-month";

/** The website's Investments card for the phone: `/api/v1/investments` and its writes. */

/** How many of each kind of activity are listed, newest first. */
export const INVESTMENT_ACTIVITY_LIMIT = 40;

type InvestmentsUser = { id: string; timezone: string | null; countryCode: string | null };

function rate(window: ReturnWindow | null) {
  return window ? displayRate(window) : null;
}

export async function loadAppInvestments(db: PrismaClient, user: InvestmentsUser) {
  const currency = homeCurrencyOf(user.countryCode);
  const todayYmd = currentYmdInTimeZone(user.timezone);
  const today = dateFromYmd(todayYmd);
  const [room, returns, accounts, flows, values, transfers] = await Promise.all([
    loadContributionRoomData(user.id, db),
    loadInvestmentReturns(user),
    db.account.findMany({
      where: { userId: user.id, archived: false },
      select: { id: true, name: true, type: true, currency: true },
      orderBy: { name: "asc" },
    }),
    db.investmentFlow.findMany({
      where: { userId: user.id },
      include: { account: { select: { name: true, currency: true } } },
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      take: INVESTMENT_ACTIVITY_LIMIT,
    }),
    db.portfolioSnapshot.findMany({
      where: { userId: user.id },
      include: { account: { select: { name: true, currency: true } } },
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      take: INVESTMENT_ACTIVITY_LIMIT,
    }),
    // Deposits into a TFSA, RRSP or FHSA that do not count toward room yet.
    db.transaction.findMany({
      where: {
        userId: user.id,
        type: TransactionType.TRANSFER,
        amountCents: { lt: 0 },
        account: { type: { in: [...REGISTERED_ACCOUNT_TYPES] } },
        investmentFlow: { is: null },
      },
      select: { id: true, amountCents: true, date: true, title: true, account: { select: { name: true, currency: true } } },
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      take: INVESTMENT_ACTIVITY_LIMIT,
    }),
  ]);

  // Only the types someone holds or has entered room for, as the card shows them.
  const held = new Set<RegisteredAccountType>([...Object.values(room.accountTypes), ...room.entries.map((e) => e.accountType)]);
  const roomFlows = roomFlowsFromData(room);
  const roomRows = REGISTERED_ACCOUNT_TYPES.filter((type) => held.has(type)).map((type) => {
    const year = computeRoomYear(type, roomYearFor(type, today), room.entries, roomFlows);
    return {
      ...year,
      overText: year.overCents > 0 ? overContributionMessage(type, year.overCents, year.year) : null,
      /** The figures entered from CRA, newest year first. */
      entries: room.entries.filter((e) => e.accountType === type).map(({ id, year: y, roomCents }) => ({ id, year: y, roomCents })),
    };
  });

  const returnRows = [
    ...returns.accounts.map((a) => ({ accountId: a.accountId as string | null, name: a.name, currency: a.currency, windows: a.windows })),
    ...(returns.total && returns.accounts.length > 1
      ? [{ accountId: null, name: "All together", currency: returns.currency, windows: returns.total }]
      : []),
  ].flatMap(({ windows, ...row }) =>
    windows.sinceStart
      ? [{ ...row, valueCents: windows.sinceStart.endCents, thisYear: rate(windows.thisYear), twelveMonths: rate(windows.twelveMonths) }]
      : [],
  );

  const activity = [
    ...flows.map((row) => ({
      kind: row.direction === "CONTRIBUTION" ? ("contribution" as const) : ("withdrawal" as const),
      id: row.id,
      accountId: row.accountId as string | null,
      accountName: row.account.name,
      currency: row.account.currency,
      amountCents: row.amountCents,
      date: ymdFromDateUtc(row.date),
      note: row.note,
      /** Recorded from a transfer with Count toward room; deleting it makes the transfer countable again. */
      fromTransfer: row.transactionId !== null,
    })),
    ...values.map((row) => ({
      kind: "value" as const,
      id: row.id,
      accountId: row.accountId as string | null,
      accountName: row.account.name,
      currency: row.account.currency,
      amountCents: row.totalValueCents,
      date: ymdFromDateUtc(row.date),
      note: row.note,
      fromTransfer: false,
    })),
    ...transfers.map((row) => ({
      kind: "transfer" as const,
      id: row.id,
      accountId: null,
      accountName: row.account?.name ?? "",
      currency: row.account?.currency ?? currency,
      // Money arriving is negative on a transfer; the list shows what came in.
      amountCents: -row.amountCents,
      date: ymdFromDateUtc(row.date),
      note: row.title,
      fromTransfer: false,
    })),
  ].sort((a, b) => b.date.localeCompare(a.date));

  return {
    currency,
    today: todayYmd,
    accounts: accounts.map((a) => ({ ...a, type: String(a.type), registered: (REGISTERED_ACCOUNT_TYPES as readonly string[]).includes(String(a.type)) })),
    room: roomRows,
    returns: returnRows,
    activity,
  };
}

const ymd = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Dates are YYYY-MM-DD.")
  .refine((value) => ymdFromDateUtc(dateFromYmd(value)) === value, "That date does not exist.");
const note = z.string().trim().max(250, "Keep the note to 250 characters.").nullable().optional();

const flowSchema = z
  .object({
    accountId: z.string().min(1, "Pick an account."),
    direction: z.enum(["contribution", "withdrawal"], "'direction' must be contribution or withdrawal."),
    amountCents: z.number().int().min(1, "The amount must be more than zero.").max(MAX_AMOUNT_CENTS),
    date: ymd,
    note,
    /** Record it even though it goes over the year's room. */
    overRoom: z.boolean().optional(),
  })
  .strict();

const valueSchema = z
  .object({
    accountId: z.string().min(1, "Pick an account."),
    totalValueCents: z.number().int().min(0, "The value can't be below zero.").max(MAX_AMOUNT_CENTS),
    date: ymd,
    note,
  })
  .strict();

const roomSchema = z
  .object({
    accountType: z.enum(REGISTERED_ACCOUNT_TYPES, "'accountType' must be TFSA, RRSP or FHSA."),
    year: z
      .number()
      .int()
      .min(2009, "Registered-account room starts in 2009.")
      .refine((year) => year <= new Date().getUTCFullYear() + 1, "That year is too far ahead."),
    // Signed: a TFSA room statement reports an existing excess as negative room.
    roomCents: z.number().int().min(-MAX_AMOUNT_CENTS).max(MAX_AMOUNT_CENTS),
  })
  .strict();

export type InvestmentResult =
  | { ok: true; id?: string }
  | { ok: false; status: 400 | 404; error: string }
  /** A contribution over the year's room, not saved until it is sent again with `overRoom`. */
  | { ok: false; status: 409; error: string; overRoom: true };

/** The answer for an investments write: 409 `{ error, overRoom: true }` for a contribution over the room. */
export function investmentResponse(result: InvestmentResult, status = 200): NextResponse {
  if (result.ok) return NextResponse.json(result.id ? { id: result.id } : { ok: true }, { status, headers: NO_STORE });
  if (result.status === 409) return NextResponse.json({ error: result.error, overRoom: true }, { status: 409, headers: NO_STORE });
  return apiError(result.error, result.status);
}

function refused(error: unknown): InvestmentResult {
  if (error instanceof InvestmentEditError) return { ok: false, status: error.notFound ? 404 : 400, error: error.message };
  throw error;
}

function firstIssue(error: z.ZodError, fallback: string): InvestmentResult {
  return { ok: false, status: 400, error: error.issues[0]?.message ?? fallback };
}

function flowInput(body: z.infer<typeof flowSchema>): InvestmentFlowInput {
  return {
    accountId: body.accountId,
    direction: body.direction === "contribution" ? "CONTRIBUTION" : "WITHDRAWAL",
    amountCents: body.amountCents,
    date: body.date,
    note: body.note || null,
  };
}

function valueInput(body: z.infer<typeof valueSchema>): PortfolioValueInput {
  return { accountId: body.accountId, totalValueCents: body.totalValueCents, date: body.date, note: body.note || null };
}

/** Adds a contribution or withdrawal (`id` absent) or changes one. Going over the room asks first, as the card's Add anyway does. */
export async function saveInvestmentFlowFromApi(db: PrismaClient, userId: string, id: string | null, body: unknown): Promise<InvestmentResult> {
  const parsed = flowSchema.safeParse(body);
  if (!parsed.success) return firstIssue(parsed.error, "Invalid contribution or withdrawal.");
  const input = flowInput(parsed.data);
  try {
    if (id) {
      await updateInvestmentFlow(db, userId, id, input);
      return { ok: true, id };
    }
    if (!parsed.data.overRoom) {
      const warning = await contributionWarning(db, userId, input);
      if (warning) return { ok: false, status: 409, error: warning, overRoom: true };
    }
    return { ok: true, id: await createInvestmentFlow(db, userId, input) };
  } catch (error) {
    return refused(error);
  }
}

export async function saveInvestmentValueFromApi(db: PrismaClient, userId: string, id: string | null, body: unknown): Promise<InvestmentResult> {
  const parsed = valueSchema.safeParse(body);
  if (!parsed.success) return firstIssue(parsed.error, "Invalid portfolio value.");
  try {
    if (id) {
      await updatePortfolioValue(db, userId, id, valueInput(parsed.data));
      return { ok: true, id };
    }
    return { ok: true, id: await createPortfolioValue(db, userId, valueInput(parsed.data)) };
  } catch (error) {
    return refused(error);
  }
}

export async function deleteInvestmentEntryFromApi(db: PrismaClient, userId: string, kind: "flow" | "value", id: string): Promise<InvestmentResult> {
  try {
    await (kind === "flow" ? deleteInvestmentFlow(db, userId, id) : deletePortfolioValue(db, userId, id));
    return { ok: true };
  } catch (error) {
    return refused(error);
  }
}

export async function countTransferFromApi(db: PrismaClient, userId: string, transactionId: string): Promise<InvestmentResult> {
  try {
    return { ok: true, id: await countTransferTowardRoom(db, userId, transactionId) };
  } catch (error) {
    return refused(error);
  }
}

export async function setRoomFromApi(db: PrismaClient, userId: string, body: unknown): Promise<InvestmentResult> {
  const parsed = roomSchema.safeParse(body);
  if (!parsed.success) return firstIssue(parsed.error, "Invalid room figure.");
  await setContributionRoom(db, userId, parsed.data);
  return { ok: true };
}

export async function deleteRoomFromApi(db: PrismaClient, userId: string, id: string): Promise<InvestmentResult> {
  try {
    await deleteContributionRoom(db, userId, id);
    return { ok: true };
  } catch (error) {
    return refused(error);
  }
}
