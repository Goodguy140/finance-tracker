"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { AUDIT_ACTIONS, recordAuditLog } from "@/lib/audit-log";
import {
  OPS_SETTING_KEYS,
  getOpsSettingsStatus,
  invalidateOpsSettingsCache,
  parseAuditRetentionInput,
  parsePlaidSyncIntervalInput,
  type OpsSettingsStatus,
} from "@/lib/ops-settings";
import { prisma } from "@/lib/prisma";
import { requireRecentIdentity } from "@/lib/recent-identity";
import { requireAdmin } from "@/lib/session";
import { setServerSetting } from "@/lib/server-settings";
import { formAction, getFormValue } from "./_helpers";

type OpsName = keyof typeof OPS_SETTING_KEYS;
type Change = { name: OpsName; value: string };

/**
 * Writes the given settings and records one audit row saying what changed.
 *
 * A setting pinned by its env var is skipped rather than written: its form field is
 * disabled, and a disabled field submits nothing, so writing it would store whatever an
 * absent value parses to — an unticked box, i.e. "off" — behind the operator's back.
 */
async function saveOpsSettings(changes: Change[], section: string) {
  const user = await requireAdmin();
  const before: OpsSettingsStatus = await getOpsSettingsStatus();
  const applied = changes.filter((change) => before[change.name].source !== "environment");

  for (const change of applied) {
    await setServerSetting(OPS_SETTING_KEYS[change.name], change.value, user.id);
  }
  invalidateOpsSettingsCache();

  // Written last, so anything waiting on this row knows every setting above is saved.
  await recordAuditLog(prisma, {
    userId: user.id,
    action: AUDIT_ACTIONS.admin_ops_settings_updated,
    metadata: {
      section,
      changes: applied.map((change) => ({
        setting: change.name,
        from: before[change.name].value,
        to: change.value,
      })),
      skippedEnvPinned: changes.filter((c) => !applied.includes(c)).map((c) => c.name),
    },
    headers: await headers(),
  });
  revalidatePath("/settings/admin", "layout");
}

export const updatePublicSignupAction = formAction(async (formData: FormData) => {
  // Opening sign-up lets anyone in: confirm it's the admin, not a borrowed cookie.
  await requireAdmin();
  await requireRecentIdentity();
  const open = getFormValue(formData, "publicSignup") === "true";
  await saveOpsSettings([{ name: "publicSignup", value: open ? "true" : "false" }], "authentication");
  revalidatePath("/signup");
});

export const updateOperationsSettingsAction = formAction(async (formData: FormData) => {
  const changes: Change[] = [
    {
      name: "recurringAutoPost",
      value: getFormValue(formData, "recurringAutoPost") === "true" ? "true" : "false",
    },
  ];
  // Absent when the field is disabled because the env var pins it.
  if (formData.has("auditRetentionDays")) {
    changes.push({
      name: "auditRetentionDays",
      value: String(parseAuditRetentionInput(getFormValue(formData, "auditRetentionDays"))),
    });
  }
  await saveOpsSettings(changes, "operations");
});

export const updatePlaidSyncIntervalAction = formAction(async (formData: FormData) => {
  if (!formData.has("plaidSyncIntervalMinutes")) return;
  const minutes = parsePlaidSyncIntervalInput(getFormValue(formData, "plaidSyncIntervalMinutes"));
  await saveOpsSettings([{ name: "plaidSyncIntervalMinutes", value: String(minutes) }], "integrations");
});
