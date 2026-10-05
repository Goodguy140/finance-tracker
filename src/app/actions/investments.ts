"use server";

import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { REGISTERED_ACCOUNT_TYPES } from "@/lib/contribution-room";
import { toCents } from "@/lib/money";
import { prisma } from "@/lib/prisma";
import { dateFromYmd } from "@/lib/date-only";
import { requireUser } from "@/lib/session";
import {
  contributionRoomSchema,
  investmentFlowSchema,
  portfolioSnapshotSchema,
} from "@/lib/validation";
import {
  getFormValue,
  assertUserOwnsAccount,
  formAction,
} from "./_helpers";
export const createInvestmentFlowAction = formAction(async (formData: FormData) => {
  const user = await requireUser();
  const payload = investmentFlowSchema.parse({
    accountId: getFormValue(formData, "accountId"),
    direction: getFormValue(formData, "direction"),
    amount: getFormValue(formData, "amount"),
    date: getFormValue(formData, "date"),
    note: getFormValue(formData, "note").trim() || undefined,
  });
  await assertUserOwnsAccount(user.id, payload.accountId);

  await prisma.investmentFlow.create({
    data: {
      userId: user.id,
      accountId: payload.accountId,
      direction: payload.direction,
      amountCents: toCents(payload.amount),
      date: dateFromYmd(payload.date),
      note: payload.note,
    },
  });
  revalidatePath("/");
});

export const createPortfolioSnapshotAction = formAction(async (formData: FormData) => {
  const user = await requireUser();
  const payload = portfolioSnapshotSchema.parse({
    accountId: getFormValue(formData, "accountId"),
    totalValue: getFormValue(formData, "totalValue"),
    date: getFormValue(formData, "date"),
    note: getFormValue(formData, "note").trim() || undefined,
  });
  await assertUserOwnsAccount(user.id, payload.accountId);

  await prisma.portfolioSnapshot.create({
    data: {
      userId: user.id,
      accountId: payload.accountId,
      totalValueCents: toCents(payload.totalValue),
      date: dateFromYmd(payload.date),
      note: payload.note,
    },
  });
  revalidatePath("/");
});

function parseFlowForm(formData: FormData) {
  return investmentFlowSchema.parse({
    accountId: getFormValue(formData, "accountId"),
    direction: getFormValue(formData, "direction"),
    amount: getFormValue(formData, "amount"),
    date: getFormValue(formData, "date"),
    note: getFormValue(formData, "note").trim() || undefined,
  });
}

function parseSnapshotForm(formData: FormData) {
  return portfolioSnapshotSchema.parse({
    accountId: getFormValue(formData, "accountId"),
    totalValue: getFormValue(formData, "totalValue"),
    date: getFormValue(formData, "date"),
    note: getFormValue(formData, "note").trim() || undefined,
  });
}

/**
 * Edits a contribution or withdrawal. A flow counted from a transfer keeps its link: the
 * amount may be corrected (a transfer that included a fee, say) without making the transfer
 * countable a second time.
 */
export const updateInvestmentFlowAction = formAction(async (formData: FormData) => {
  const user = await requireUser();
  const id = getFormValue(formData, "id");
  const payload = parseFlowForm(formData);
  await assertUserOwnsAccount(user.id, payload.accountId);

  const { count } = await prisma.investmentFlow.updateMany({
    where: { id, userId: user.id },
    data: {
      accountId: payload.accountId,
      direction: payload.direction,
      amountCents: toCents(payload.amount),
      date: dateFromYmd(payload.date),
      note: payload.note ?? null,
    },
  });
  if (count === 0) throw new Error("That contribution or withdrawal was not found.");
  revalidatePath("/");
  revalidatePath("/settings");
});

/** Deleting a flow counted from a transfer makes that transfer countable again. */
export const deleteInvestmentFlowAction = formAction(async (formData: FormData) => {
  const user = await requireUser();
  const id = getFormValue(formData, "id");
  const { count } = await prisma.investmentFlow.deleteMany({ where: { id, userId: user.id } });
  if (count === 0) throw new Error("That contribution or withdrawal was not found.");
  revalidatePath("/");
  revalidatePath("/settings");
});

export const updatePortfolioSnapshotAction = formAction(async (formData: FormData) => {
  const user = await requireUser();
  const id = getFormValue(formData, "id");
  const payload = parseSnapshotForm(formData);
  await assertUserOwnsAccount(user.id, payload.accountId);

  const { count } = await prisma.portfolioSnapshot.updateMany({
    where: { id, userId: user.id },
    data: {
      accountId: payload.accountId,
      totalValueCents: toCents(payload.totalValue),
      date: dateFromYmd(payload.date),
      note: payload.note ?? null,
    },
  });
  if (count === 0) throw new Error("That portfolio value was not found.");
  revalidatePath("/");
});

export const deletePortfolioSnapshotAction = formAction(async (formData: FormData) => {
  const user = await requireUser();
  const id = getFormValue(formData, "id");
  const { count } = await prisma.portfolioSnapshot.deleteMany({ where: { id, userId: user.id } });
  if (count === 0) throw new Error("That portfolio value was not found.");
  revalidatePath("/");
});

/**
 * Records a contribution from a transfer that arrived in a TFSA, RRSP or FHSA, so a deposit
 * synced from the bank does not have to be typed in again for contribution room. Transfers
 * follow the expense sign, so money arriving is a negative amount.
 */
export const countTransferTowardRoomAction = formAction(async (formData: FormData) => {
  const user = await requireUser();
  const transactionId = getFormValue(formData, "transactionId");
  const transfer = await prisma.transaction.findFirst({
    where: {
      id: transactionId,
      userId: user.id,
      type: "TRANSFER",
      amountCents: { lt: 0 },
      account: { type: { in: [...REGISTERED_ACCOUNT_TYPES] } },
    },
    select: { id: true, accountId: true, amountCents: true, date: true, title: true },
  });
  if (!transfer?.accountId) throw new Error("Only a transfer into a TFSA, RRSP or FHSA can count toward room.");

  try {
    await prisma.investmentFlow.create({
      data: {
        userId: user.id,
        accountId: transfer.accountId,
        direction: "CONTRIBUTION",
        amountCents: -transfer.amountCents,
        date: transfer.date,
        note: transfer.title?.slice(0, 250) || null,
        transactionId: transfer.id,
      },
    });
  } catch (error) {
    // Already counted (two clicks, or two tabs): the unique link refuses the second.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new Error("That transfer already counts toward room.");
    }
    throw error;
  }
  revalidatePath("/");
  revalidatePath("/settings");
});

/** Saves one year's room for one account type, replacing any figure already entered. */
export const upsertContributionRoomAction = formAction(async (formData: FormData) => {
  const user = await requireUser();
  const payload = contributionRoomSchema.parse({
    accountType: getFormValue(formData, "accountType"),
    year: getFormValue(formData, "year"),
    room: getFormValue(formData, "room"),
  });
  const roomCents = toCents(payload.room);
  await prisma.contributionRoom.upsert({
    where: { userId_accountType_year: { userId: user.id, accountType: payload.accountType, year: payload.year } },
    create: { userId: user.id, accountType: payload.accountType, year: payload.year, roomCents },
    update: { roomCents },
  });
  revalidatePath("/");
  revalidatePath("/settings");
});

export const deleteContributionRoomAction = formAction(async (formData: FormData) => {
  const user = await requireUser();
  const id = getFormValue(formData, "id");
  const { count } = await prisma.contributionRoom.deleteMany({ where: { id, userId: user.id } });
  if (count === 0) throw new Error("That room figure was not found.");
  revalidatePath("/");
  revalidatePath("/settings");
});
