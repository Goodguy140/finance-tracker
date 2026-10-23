"use server";

import { revalidatePath } from "next/cache";
import { addAttachment, MAX_ATTACHMENT_BYTES, type AttachmentRefusal } from "@/lib/attachments";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";
import { formAction, getFormValue } from "./_helpers";

const REFUSALS: Record<AttachmentRefusal, string> = {
  empty: "That file is empty.",
  "too-large": `Receipts can be up to ${MAX_ATTACHMENT_BYTES / (1024 * 1024)} MB.`,
  type: "Only photos (JPEG, PNG, WebP, GIF, HEIC) and PDFs can be kept as receipts.",
  "too-many": "This entry already has as many receipts as it can hold.",
  "not-found": "Transaction not found.",
};

/** Keeps a receipt with one of the user's transactions. */
export const addAttachmentAction = formAction(async (formData: FormData) => {
  const user = await requireUser();
  const transactionId = getFormValue(formData, "transactionId");
  const file = formData.get("file");
  if (!transactionId || !(file instanceof File)) throw new Error("Choose a file to attach.");
  const result = await addAttachment(prisma, {
    userId: user.id,
    transactionId,
    fileName: file.name,
    bytes: new Uint8Array(await file.arrayBuffer()),
  });
  if (!result.ok) throw new Error(REFUSALS[result.reason]);
  revalidatePath("/");
});

export const removeAttachmentAction = formAction(async (formData: FormData) => {
  const user = await requireUser();
  const id = getFormValue(formData, "attachmentId");
  const removed = await prisma.transactionAttachment.deleteMany({ where: { id, userId: user.id } });
  if (removed.count === 0) throw new Error("Receipt not found.");
  revalidatePath("/");
});
