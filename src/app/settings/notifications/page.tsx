import { BillReminderPreferences } from "@/components/bill-reminder-preferences";
import { CalendarFeedPreferences } from "@/components/calendar-feed-preferences";
import { BudgetAlertPreferences } from "@/components/budget-alert-preferences";
import { ChargeAlertPreferences } from "@/components/charge-alert-preferences";
import { EmailDigestPreferences } from "@/components/email-digest-preferences";
import { PushNotificationPreferences } from "@/components/push-notification-preferences";
import { SettingsPage } from "@/components/settings/ui";
import { isBudgetAlertEmailConfigured } from "@/lib/budget-alert-email";
import { homeCurrencyOf } from "@/lib/home-currency";
import { prisma } from "@/lib/prisma";
import { getVapidKeys } from "@/lib/push-notifications";
import { requireLoadedUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function NotificationsSettingsPage() {
  const { user } = await requireLoadedUser();
  const [chargeAlerts, devices, vapid, calendarFeed] = await Promise.all([
    prisma.chargeAlertSetting.findUnique({ where: { userId: user.id } }),
    prisma.pushDevice.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "asc" },
      select: { id: true, label: true, endpoint: true, createdAt: true, billReminders: true, chargeAlerts: true, budgetAlerts: true },
    }),
    getVapidKeys(),
    prisma.calendarFeed.findUnique({ where: { userId: user.id }, select: { createdAt: true, lastFetchedAt: true } }),
  ]);
  return (
    <SettingsPage section="notifications">
      <BudgetAlertPreferences emailConfigured={isBudgetAlertEmailConfigured()} emailEnabled={user.budgetAlertEmailEnabled} />
      <EmailDigestPreferences emailConfigured={isBudgetAlertEmailConfigured()} frequency={user.digestFrequency} />
      <BillReminderPreferences
        emailConfigured={isBudgetAlertEmailConfigured()}
        phoneReady={devices.some((d) => d.billReminders)}
        days={user.billReminderDays}
      />
      <ChargeAlertPreferences
        emailConfigured={isBudgetAlertEmailConfigured()}
        phoneReady={devices.some((d) => d.chargeAlerts)}
        currency={homeCurrencyOf(user.countryCode)}
        thresholdCents={chargeAlerts?.thresholdCents ?? null}
        unusual={chargeAlerts?.unusual ?? false}
      />
      <PushNotificationPreferences
        vapidPublicKey={vapid.publicKey}
        devices={devices.map((d) => ({ ...d, createdAt: d.createdAt.toISOString() }))}
      />
      <CalendarFeedPreferences
        feed={
          calendarFeed
            ? { createdAt: calendarFeed.createdAt.toISOString(), lastFetchedAt: calendarFeed.lastFetchedAt?.toISOString() ?? null }
            : null
        }
      />
    </SettingsPage>
  );
}
