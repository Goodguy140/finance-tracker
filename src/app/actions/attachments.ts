"use server";

import { revalidatePath } from "next/cache";
import { addAttachment, ATTACHMENT_REFUSAL_MESSAGES } from "@/lib/attachments";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";
import { formAction, getFormValue } from "./_helpers";

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
  if (!result.ok) throw new Error(ATTACHMENT_REFUSAL_MESSAGES[result.reason]);
  revalidatePath("/");
});

export const removeAttachmentAction = formAction(async (formData: FormData) => {
  const user = await requireUser();
  const id = getFormValue(formData, "attachmentId");
  const removed = await prisma.transactionAttachment.deleteMany({ where: { id, userId: user.id } });
  if (removed.count === 0) throw new Error("Receipt not found.");
  revalidatePath("/");
});
