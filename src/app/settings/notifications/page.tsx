import { BudgetAlertPreferences } from "@/components/budget-alert-preferences";
import { SettingsPage } from "@/components/settings/ui";
import { isBudgetAlertEmailConfigured } from "@/lib/budget-alert-email";
import { requireLoadedUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function NotificationsSettingsPage() {
  const { user } = await requireLoadedUser();
  return (
    <SettingsPage section="notifications">
      <BudgetAlertPreferences emailConfigured={isBudgetAlertEmailConfigured()} emailEnabled={user.budgetAlertEmailEnabled} />
    </SettingsPage>
  );
}
