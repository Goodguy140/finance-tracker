import { BackupForms, DangerZoneForms } from "@/components/settings/data-forms";
import { SettingsCard, SettingsFold, SettingsPage } from "@/components/settings/ui";
import { requireLoadedUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function BackupSettingsPage() {
  await requireLoadedUser();
  return (
    <SettingsPage section="backup">
      <SettingsCard title="Backup and restore">
        <BackupForms />
      </SettingsCard>
      {/* Folded so neither irreversible action is one stray click from a routine backup. */}
      <SettingsFold id="danger-zone" title="Danger zone" meta="Clear your data or delete this login">
        <DangerZoneForms />
      </SettingsFold>
    </SettingsPage>
  );
}
