import { InstallPrompt } from "@/components/pwa/install-prompt";
import { ReadabilityForm } from "@/components/settings/you-forms";
import { SettingsCard, SettingsPage } from "@/components/settings/ui";
import { requireLoadedUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function AppearanceSettingsPage() {
  const { user } = await requireLoadedUser();
  return (
    <SettingsPage section="appearance">
      <SettingsCard
        title="Dashboard readability"
        description="When the window is too narrow for your cards' text, the dashboard merges a column away to give the rest more room."
      >
        <ReadabilityForm
          initial={{
            textVisiblePct: user.dashboardTextVisiblePct,
            budgetNameVisiblePct: user.dashboardBudgetNameVisiblePct,
          }}
        />
      </SettingsCard>
      <InstallPrompt />
    </SettingsPage>
  );
}
