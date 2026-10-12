import { SavingsGoalsPanel } from "@/components/settings/savings-goals-panel";
import { SettingsPage } from "@/components/settings/ui";
import { loadSavingsGoals } from "@/lib/savings-goals-data";
import { requireLoadedUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function GoalsSettingsPage() {
  const { user } = await requireLoadedUser();
  const { goals, accounts } = await loadSavingsGoals(user);
  return (
    <SettingsPage section="goals">
      <SavingsGoalsPanel goals={goals} accounts={accounts} />
    </SettingsPage>
  );
}
