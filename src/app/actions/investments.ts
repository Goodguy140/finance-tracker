"use server";

import { revalidatePath } from "next/cache";
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
