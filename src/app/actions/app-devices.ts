"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { appRedirectUrl, createAppSignInCode, parseAuthorizeRequest, signOutAppDevice } from "@/lib/app-devices";
import { AUDIT_ACTIONS, recordAuditLog } from "@/lib/audit-log";
import { prisma } from "@/lib/prisma";
import { requireRecentIdentity } from "@/lib/recent-identity";
import { requireUser } from "@/lib/session";
import { formAction, formActionWithResult, getFormValue } from "./_helpers";

/**
 * "Allow" on `/app/authorize`. A device token lets a phone in until it is signed out, so
 * issuing one changes who can get in: it needs a recent "confirm it's you", like the other
 * actions of that kind (AGENTS.md → Security). Returns the URL that hands the code to the app.
 */
export const approveAppSignInAction = formActionWithResult(
  async (formData: FormData): Promise<{ ok: true; redirectUrl: string }> => {
    const { user } = await requireRecentIdentity();
    const parsed = parseAuthorizeRequest({
      code_challenge: getFormValue(formData, "code_challenge"),
      state: getFormValue(formData, "state"),
      device: getFormValue(formData, "device"),
    });
    if (!parsed.ok) throw new Error(parsed.error);
    const created = await createAppSignInCode({ userId: user.id, request: parsed.request });
    if (!created.ok) throw new Error(created.error);
    return { ok: true, redirectUrl: appRedirectUrl({ code: created.code }, parsed.request.state) };
  },
);

/** Settings → Security → Signed-in apps: ends one phone's access. No step-up: it only takes access away. */
export const signOutAppDeviceAction = formAction(async (formData: FormData) => {
  const user = await requireUser();
  const device = await signOutAppDevice({ userId: user.id, deviceId: getFormValue(formData, "deviceId") });
  if (!device) throw new Error("That phone is already signed out.");
  await recordAuditLog(prisma, {
    userId: user.id,
    action: AUDIT_ACTIONS.app_device_signed_out,
    targetType: "app_device",
    targetId: device.id,
    metadata: { name: device.name, by: "settings" },
    headers: await headers(),
  });
  revalidatePath("/settings/security");
});
