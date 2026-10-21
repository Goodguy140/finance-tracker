import type { PrismaClient } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { after } from "next/server";
import { sendBudgetAlertEmail, isBudgetAlertEmailConfigured } from "@/lib/budget-alert-email";
import { computeBudgetWarnings, type BudgetWarning } from "@/lib/budget-alerts";
import { buildMonthlyBudgetProgress } from "@/lib/budget-progress";
import { formatYmLongLabel } from "@/lib/dashboard-period";
import { homeCurrencyOf } from "@/lib/home-currency";
import { currentYmInTimeZone } from "@/lib/period-month";
import { prisma } from "@/lib/prisma";

/**
 * Budget alert emails.
 *
 * The Settings toggle for these used to live in localStorage and nothing on the server
 * ever read it, so no email was ever sent. The opt-in now lives on the user row and this
 * runs after any action that changes the current month's spending: it recomputes the
 * month's budget warnings and emails each one that has not been announced yet. A
 * `BudgetAlertNotification` row per (month, category, severity) is the memory, so a
 * category that stays over budget is announced once at 80% and once more when it goes
 * over, not on every expense.
 */

export type BudgetAlertDispatchResult = { sent: number; skipped: "disabled" | "smtp" | null };

function subjectFor(warning: BudgetWarning): string {
  return warning.severity === "critical"
    ? `Over budget: ${warning.categoryName}`
    : `Budget warning: ${warning.categoryName} at ${warning.percentUsed}%`;
}

function bodyFor(warning: BudgetWarning, monthLabel: string, baseUrl: string | undefined): string {
  const lines = [
    `${warning.message}`,
    "",
    `Month: ${monthLabel}`,
    `Category: ${warning.categoryName}`,
  ];
  if (baseUrl) lines.push("", `Open your dashboard: ${baseUrl}/`);
  lines.push("", "You are receiving this because budget email alerts are enabled in Settings → Notifications.");
  return lines.join("\n");
}

export async function dispatchBudgetAlertEmails(
  userId: string,
  client: PrismaClient = prisma,
  now = new Date(),
): Promise<BudgetAlertDispatchResult> {
  const user = await client.user.findUnique({
    where: { id: userId },
    select: { email: true, timezone: true, countryCode: true, budgetAlertEmailEnabled: true },
  });
  if (!user?.budgetAlertEmailEnabled) return { sent: 0, skipped: "disabled" };
  if (!isBudgetAlertEmailConfigured()) return { sent: 0, skipped: "smtp" };

  const ym = currentYmInTimeZone(user.timezone, now);
  const progress = await buildMonthlyBudgetProgress(userId, ym, client);
  const warnings = computeBudgetWarnings(
    progress.budgets.map((row) => ({
      categoryId: row.categoryId,
      categoryName: row.categoryName,
      spentCents: row.spentCents,
      limitCents: row.limitCents,
    })),
    { ym, reference: now, currency: homeCurrencyOf(user.countryCode) },
  );

  const monthLabel = formatYmLongLabel(ym);
  const baseUrl = process.env.NEXTAUTH_URL?.trim().replace(/\/$/, "");
  let sent = 0;
  for (const warning of warnings) {
    // Claim the (month, category, severity) slot first; the unique index makes two
    // concurrent actions agree on a single sender.
    try {
      await client.budgetAlertNotification.create({
        data: { userId, periodMonth: ym, categoryId: warning.categoryId, severity: warning.severity },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") continue;
      throw err;
    }
    // A transport error throws rather than returning `sent: false`. Either way the slot is
    // released so the next spending change retries, and a throw is logged rather than
    // propagated so it does not cost the other warnings in this dispatch their email.
    let delivered = false;
    try {
      delivered = (
        await sendBudgetAlertEmail({
          to: user.email,
          subject: subjectFor(warning),
          text: bodyFor(warning, monthLabel, baseUrl),
        })
      ).sent;
    } catch (err) {
      console.error(`[budget-alerts] sending the ${warning.categoryName} alert failed`, err);
    }
    if (delivered) {
      sent += 1;
    } else {
      await client.budgetAlertNotification.deleteMany({
        where: { userId, periodMonth: ym, categoryId: warning.categoryId, severity: warning.severity },
      });
    }
  }
  return { sent, skipped: null };
}

/**
 * Runs the dispatch once the action's response is on its way (`after`), so the extra
 * queries and the SMTP round trip never delay the form. Outside a request scope (tests,
 * scripts) it simply runs in the background.
 */
export function scheduleBudgetAlertEmails(userId: string): void {
  const run = () =>
    dispatchBudgetAlertEmails(userId).catch((err) => {
      console.error("[budget-alerts] email dispatch failed", err);
    });
  try {
    after(run);
  } catch {
    void run();
  }
}
