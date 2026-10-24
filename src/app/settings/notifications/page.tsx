import { BillReminderPreferences } from "@/components/bill-reminder-preferences";
import { BudgetAlertPreferences } from "@/components/budget-alert-preferences";
import { ChargeAlertPreferences } from "@/components/charge-alert-preferences";
import { EmailDigestPreferences } from "@/components/email-digest-preferences";
import { SettingsPage } from "@/components/settings/ui";
import { isBudgetAlertEmailConfigured } from "@/lib/budget-alert-email";
import { homeCurrencyOf } from "@/lib/home-currency";
import { prisma } from "@/lib/prisma";
import { requireLoadedUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function NotificationsSettingsPage() {
  const { user } = await requireLoadedUser();
  const chargeAlerts = await prisma.chargeAlertSetting.findUnique({ where: { userId: user.id } });
  return (
    <SettingsPage section="notifications">
      <BudgetAlertPreferences emailConfigured={isBudgetAlertEmailConfigured()} emailEnabled={user.budgetAlertEmailEnabled} />
      <EmailDigestPreferences emailConfigured={isBudgetAlertEmailConfigured()} frequency={user.digestFrequency} />
      <BillReminderPreferences emailConfigured={isBudgetAlertEmailConfigured()} days={user.billReminderDays} />
      <ChargeAlertPreferences
        emailConfigured={isBudgetAlertEmailConfigured()}
        currency={homeCurrencyOf(user.countryCode)}
        thresholdCents={chargeAlerts?.thresholdCents ?? null}
        unusual={chargeAlerts?.unusual ?? false}
      />
    </SettingsPage>
  );
}
