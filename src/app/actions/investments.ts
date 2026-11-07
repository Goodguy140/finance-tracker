"use server";

import { revalidatePath } from "next/cache";
import {
  countTransferTowardRoom,
  createInvestmentFlow,
  createPortfolioValue,
  deleteContributionRoom,
  deleteInvestmentFlow,
  deletePortfolioValue,
  setContributionRoom,
  updateInvestmentFlow,
  updatePortfolioValue,
  type InvestmentFlowInput,
  type PortfolioValueInput,
} from "@/lib/investment-edits";
import { toCents } from "@/lib/money";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";
import {
  contributionRoomSchema,
  investmentFlowSchema,
  portfolioSnapshotSchema,
} from "@/lib/validation";
import { getFormValue, formAction } from "./_helpers";

/** The Investments card's and Settings → Accounts' forms; the saving is `src/lib/investment-edits.ts`, shared with the phone. */

function parseFlowForm(formData: FormData): InvestmentFlowInput {
  const payload = investmentFlowSchema.parse({
    accountId: getFormValue(formData, "accountId"),
    direction: getFormValue(formData, "direction"),
    amount: getFormValue(formData, "amount"),
    date: getFormValue(formData, "date"),
    note: getFormValue(formData, "note").trim() || undefined,
  });
  return {
    accountId: payload.accountId,
    direction: payload.direction,
    amountCents: toCents(payload.amount),
    date: payload.date,
    note: payload.note ?? null,
  };
}

function parseSnapshotForm(formData: FormData): PortfolioValueInput {
  const payload = portfolioSnapshotSchema.parse({
    accountId: getFormValue(formData, "accountId"),
    totalValue: getFormValue(formData, "totalValue"),
    date: getFormValue(formData, "date"),
    note: getFormValue(formData, "note").trim() || undefined,
  });
  return {
    accountId: payload.accountId,
    totalValueCents: toCents(payload.totalValue),
    date: payload.date,
    note: payload.note ?? null,
  };
}

export const createInvestmentFlowAction = formAction(async (formData: FormData) => {
  const user = await requireUser();
  await createInvestmentFlow(prisma, user.id, parseFlowForm(formData));
  revalidatePath("/");
});

export const createPortfolioSnapshotAction = formAction(async (formData: FormData) => {
  const user = await requireUser();
  await createPortfolioValue(prisma, user.id, parseSnapshotForm(formData));
  revalidatePath("/");
});

export const updateInvestmentFlowAction = formAction(async (formData: FormData) => {
  const user = await requireUser();
  await updateInvestmentFlow(prisma, user.id, getFormValue(formData, "id"), parseFlowForm(formData));
  revalidatePath("/");
  revalidatePath("/settings", "layout");
});

export const deleteInvestmentFlowAction = formAction(async (formData: FormData) => {
  const user = await requireUser();
  await deleteInvestmentFlow(prisma, user.id, getFormValue(formData, "id"));
  revalidatePath("/");
  revalidatePath("/settings", "layout");
});

export const updatePortfolioSnapshotAction = formAction(async (formData: FormData) => {
  const user = await requireUser();
  await updatePortfolioValue(prisma, user.id, getFormValue(formData, "id"), parseSnapshotForm(formData));
  revalidatePath("/");
});

export const deletePortfolioSnapshotAction = formAction(async (formData: FormData) => {
  const user = await requireUser();
  await deletePortfolioValue(prisma, user.id, getFormValue(formData, "id"));
  revalidatePath("/");
});

export const countTransferTowardRoomAction = formAction(async (formData: FormData) => {
  const user = await requireUser();
  await countTransferTowardRoom(prisma, user.id, getFormValue(formData, "transactionId"));
  revalidatePath("/");
  revalidatePath("/settings", "layout");
});

/** Saves one year's room for one account type, replacing any figure already entered. */
export const upsertContributionRoomAction = formAction(async (formData: FormData) => {
  const user = await requireUser();
  const payload = contributionRoomSchema.parse({
    accountType: getFormValue(formData, "accountType"),
    year: getFormValue(formData, "year"),
    room: getFormValue(formData, "room"),
  });
  await setContributionRoom(prisma, user.id, { accountType: payload.accountType, year: payload.year, roomCents: toCents(payload.room) });
  revalidatePath("/");
  revalidatePath("/settings", "layout");
});

export const deleteContributionRoomAction = formAction(async (formData: FormData) => {
  const user = await requireUser();
  await deleteContributionRoom(prisma, user.id, getFormValue(formData, "id"));
  revalidatePath("/");
  revalidatePath("/settings", "layout");
});
